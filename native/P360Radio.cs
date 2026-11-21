// Project 360 radio helper: Bluetooth (scan, pair, unpair) and Wi-Fi (scan, connect) through
// the Windows Runtime device APIs. Same stdio protocol as p360-native: tab-separated commands in
// ("id\tcmd\targ..."), JSON lines out ({"id":..,"ok":..,"result":..} or {"ev":..}).
// C# 5 so it compiles with the csc.exe that ships with Windows; build-native.js passes the
// WinMetadata references.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Windows.Devices.Enumeration;
using Windows.Devices.Radios;
using Windows.Devices.WiFi;
using Windows.Foundation;
using Windows.Networking.Connectivity;
using Windows.Security.Credentials;

namespace P360Radio
{
    static class Program
    {
        static readonly object outLock = new object();

        public static void Emit(string json)
        {
            lock (outLock) { Console.Out.Write(json + "\n"); Console.Out.Flush(); }
        }

        static void Main()
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            Emit("{\"ev\":\"ready\"}");
            string line;
            while ((line = stdin.ReadLine()) != null)
            {
                var p = line.Split('\t');
                if (p.Length < 2) continue;
                var id = p[0];
                Task.Run(async () =>
                {
                    try
                    {
                        string result = await Dispatch(p);
                        Emit("{\"id\":" + id + ",\"ok\":true,\"result\":" + result + "}");
                    }
                    catch (Exception ex)
                    {
                        var e = ex is AggregateException && ex.InnerException != null ? ex.InnerException : ex;
                        Emit("{\"id\":" + id + ",\"ok\":false,\"error\":" + Json.Str(e.Message) + "}");
                    }
                });
            }
            Bt.StopScan();
        }

        static string Arg(string[] p, int i) { return i < p.Length ? p[i] : ""; }

        static async Task<string> Dispatch(string[] p)
        {
            switch (p[1])
            {
                case "radios": return await Radios.List();
                case "radio.set": return await Radios.Set(Arg(p, 2), Arg(p, 3) == "on");
                case "bt.paired": return await Bt.Paired();
                case "bt.scan.start": Bt.StartScan(); return "true";
                case "bt.scan.stop": Bt.StopScan(); return "true";
                case "bt.pair": return await Bt.Pair(Arg(p, 2));
                case "bt.reply": Bt.Reply(Arg(p, 2), Arg(p, 3) == "1", Arg(p, 4)); return "true";
                case "bt.unpair": return await Bt.Unpair(Arg(p, 2));
                case "wifi.scan": return await Wifi.Scan(true);
                case "wifi.status": return await Wifi.Scan(false);
                case "wifi.connect": return await Wifi.Connect(Arg(p, 2), Arg(p, 3), Arg(p, 4) != "0");
                case "wifi.disconnect": return await Wifi.Disconnect();
            }
            throw new Exception("unknown command " + p[1]);
        }
    }

    // WinRT async → Task without the WindowsRuntimeSystemExtensions awaiters.
    static class W
    {
        public static Task<T> A<T>(IAsyncOperation<T> op)
        {
            var t = new TaskCompletionSource<T>();
            op.Completed = (o, s) =>
            {
                if (s == AsyncStatus.Completed) t.TrySetResult(o.GetResults());
                else if (s == AsyncStatus.Error) t.TrySetException(o.ErrorCode);
                else t.TrySetCanceled();
            };
            return t.Task;
        }

        public static Task A(IAsyncAction op)
        {
            var t = new TaskCompletionSource<bool>();
            op.Completed = (o, s) =>
            {
                if (s == AsyncStatus.Completed) t.TrySetResult(true);
                else if (s == AsyncStatus.Error) t.TrySetException(o.ErrorCode);
                else t.TrySetCanceled();
            };
            return t.Task;
        }
    }

    static class Json
    {
        public static string Str(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u" + ((int)c).ToString("x4")); else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }

        public static string Bool(bool b) { return b ? "true" : "false"; }

        public static string Num(object v)
        {
            if (v == null) return "null";
            try { return Convert.ToInt64(v, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture); } catch { return "null"; }
        }
    }

    static class Radios
    {
        public static async Task<string> List()
        {
            var list = await W.A(Radio.GetRadiosAsync());
            var items = new List<string>();
            foreach (var r in list)
            {
                if (r.Kind != RadioKind.Bluetooth && r.Kind != RadioKind.WiFi) continue;
                items.Add("{\"kind\":" + Json.Str(r.Kind == RadioKind.Bluetooth ? "bluetooth" : "wifi") +
                    ",\"name\":" + Json.Str(r.Name) + ",\"state\":" + Json.Str(r.State.ToString().ToLowerInvariant()) + "}");
            }
            return "[" + string.Join(",", items) + "]";
        }

        public static async Task<string> Set(string kind, bool on)
        {
            var access = await W.A(Radio.RequestAccessAsync());
            if (access != RadioAccessStatus.Allowed) throw new Exception("Windows didn't allow radio control (" + access + ")");
            foreach (var r in await W.A(Radio.GetRadiosAsync()))
            {
                bool match = (kind == "bluetooth" && r.Kind == RadioKind.Bluetooth) || (kind == "wifi" && r.Kind == RadioKind.WiFi);
                if (!match) continue;
                var res = await W.A(r.SetStateAsync(on ? RadioState.On : RadioState.Off));
                if (res != RadioAccessStatus.Allowed) throw new Exception("Couldn't turn " + r.Name + (on ? " on" : " off") + " (" + res + ")");
            }
            return await List();
        }
    }

    static class Bt
    {
        const string BT = "{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}";
        const string BLE = "{bb7bb05e-5972-42b5-94fc-76eaa7084d49}";
        static readonly string[] Props =
        {
            "System.Devices.Aep.IsPaired", "System.Devices.Aep.IsConnected", "System.Devices.Aep.SignalStrength",
            "System.Devices.Aep.ProtocolId", "System.Devices.Aep.Bluetooth.Cod.Major", "System.Devices.Aep.Bluetooth.Cod.Minor",
            "System.Devices.Aep.Bluetooth.Le.Appearance.Category",
        };

        static string Selector(bool paired)
        {
            return "(System.Devices.Aep.ProtocolId:=\"" + BT + "\" OR System.Devices.Aep.ProtocolId:=\"" + BLE + "\") AND " +
                   "System.Devices.Aep.IsPaired:=System.StructuredQueryType.Boolean#" + (paired ? "True" : "False");
        }

        static object Prop(DeviceInformation d, string key)
        {
            object v;
            return d.Properties.TryGetValue(key, out v) ? v : null;
        }

        static string Dev(DeviceInformation d)
        {
            object proto = Prop(d, "System.Devices.Aep.ProtocolId");
            bool ble = proto is Guid && string.Equals(((Guid)proto).ToString("B"), BLE, StringComparison.OrdinalIgnoreCase);
            return "{\"id\":" + Json.Str(d.Id) + ",\"name\":" + Json.Str(d.Name) +
                ",\"paired\":" + Json.Bool(Prop(d, "System.Devices.Aep.IsPaired") as bool? == true) +
                ",\"connected\":" + Json.Bool(Prop(d, "System.Devices.Aep.IsConnected") as bool? == true) +
                ",\"rssi\":" + Json.Num(Prop(d, "System.Devices.Aep.SignalStrength")) +
                ",\"ble\":" + Json.Bool(ble) +
                ",\"major\":" + Json.Num(Prop(d, "System.Devices.Aep.Bluetooth.Cod.Major")) +
                ",\"minor\":" + Json.Num(Prop(d, "System.Devices.Aep.Bluetooth.Cod.Minor")) +
                ",\"le\":" + Json.Num(Prop(d, "System.Devices.Aep.Bluetooth.Le.Appearance.Category")) + "}";
        }

        // FindAllAsync on association endpoints always runs a ~30 s inquiry first. A watcher
        // reports the known (paired) devices straight away, so collect briefly and stop.
        public static async Task<string> Paired()
        {
            var list = new Dictionary<string, DeviceInformation>();
            var done = new TaskCompletionSource<bool>();
            var w = DeviceInformation.CreateWatcher(Selector(true), Props, DeviceInformationKind.AssociationEndpoint);
            w.Added += (s, d) => { lock (list) list[d.Id] = d; };
            w.Updated += (s, u) => { lock (list) { DeviceInformation d; if (list.TryGetValue(u.Id, out d)) d.Update(u); } };
            w.Removed += (s, u) => { lock (list) list.Remove(u.Id); };
            w.EnumerationCompleted += (s, o) => done.TrySetResult(true);
            w.Start();
            await Task.WhenAny(done.Task, Task.Delay(2000));
            await Task.Delay(300); // late connection-state updates
            try { w.Stop(); } catch { /* stopping */ }
            lock (list) return "[" + string.Join(",", list.Values.Where(d => !string.IsNullOrEmpty(d.Name)).Select(Dev)) + "]";
        }

        // ---- scanning: a DeviceWatcher streams bt.found / bt.gone events for up to 40 s.
        static readonly object scanLock = new object();
        static DeviceWatcher watcher;
        static Timer stopTimer;
        static readonly Dictionary<string, DeviceInformation> found = new Dictionary<string, DeviceInformation>();

        public static void StartScan()
        {
            lock (scanLock)
            {
                StopLocked();
                found.Clear();
                var w = DeviceInformation.CreateWatcher(Selector(false), Props, DeviceInformationKind.AssociationEndpoint);
                w.Added += (s, d) =>
                {
                    lock (scanLock) { if (watcher != s) return; found[d.Id] = d; }
                    if (!string.IsNullOrEmpty(d.Name)) Program.Emit("{\"ev\":\"bt.found\",\"dev\":" + Dev(d) + "}");
                };
                w.Updated += (s, u) =>
                {
                    DeviceInformation d;
                    lock (scanLock) { if (watcher != s || !found.TryGetValue(u.Id, out d)) return; d.Update(u); }
                    if (!string.IsNullOrEmpty(d.Name)) Program.Emit("{\"ev\":\"bt.found\",\"dev\":" + Dev(d) + "}");
                };
                w.Removed += (s, u) =>
                {
                    lock (scanLock) { if (watcher != s) return; found.Remove(u.Id); }
                    Program.Emit("{\"ev\":\"bt.gone\",\"id\":" + Json.Str(u.Id) + "}");
                };
                w.Stopped += (s, o) => Program.Emit("{\"ev\":\"bt.scanDone\"}");
                watcher = w;
                w.Start();
                stopTimer = new Timer(_ => StopScan(), null, 40000, Timeout.Infinite);
            }
        }

        public static void StopScan() { lock (scanLock) StopLocked(); }

        static void StopLocked()
        {
            if (stopTimer != null) { stopTimer.Dispose(); stopTimer = null; }
            if (watcher == null) return;
            var w = watcher;
            watcher = null;
            try
            {
                if (w.Status == DeviceWatcherStatus.Started || w.Status == DeviceWatcherStatus.EnumerationCompleted) w.Stop();
            }
            catch { /* already stopping */ }
        }

        // ---- pairing: ConfirmOnly is accepted here; PIN ceremonies ask the dashboard (bt.pairing
        // event) and wait for bt.reply.
        static readonly Dictionary<string, TaskCompletionSource<string[]>> replies = new Dictionary<string, TaskCompletionSource<string[]>>();

        public static void Reply(string id, bool accept, string pin)
        {
            TaskCompletionSource<string[]> t;
            lock (replies)
            {
                if (!replies.TryGetValue(id, out t)) return;
                replies.Remove(id);
            }
            t.TrySetResult(new[] { accept ? "1" : "0", pin ?? "" });
        }

        static string KindName(DevicePairingKinds k)
        {
            if (k == DevicePairingKinds.DisplayPin) return "displayPin";
            if (k == DevicePairingKinds.ConfirmPinMatch) return "confirmPin";
            if (k == DevicePairingKinds.ProvidePin) return "providePin";
            return k.ToString();
        }

        public static async Task<string> Pair(string id)
        {
            var d = await W.A(DeviceInformation.CreateFromIdAsync(id, Props, DeviceInformationKind.AssociationEndpoint));
            if (d.Pairing.IsPaired) return "{\"status\":\"AlreadyPaired\",\"paired\":true}";
            lock (scanLock) StopLocked(); // inquiry scans slow pairing down
            var custom = d.Pairing.Custom;
            TypedEventHandler<DeviceInformationCustomPairing, DevicePairingRequestedEventArgs> onRequest = (s, a) =>
            {
                if (a.PairingKind == DevicePairingKinds.ConfirmOnly) { a.Accept(); return; }
                var deferral = a.GetDeferral();
                var tcs = new TaskCompletionSource<string[]>();
                lock (replies) replies[id] = tcs;
                Program.Emit("{\"ev\":\"bt.pairing\",\"id\":" + Json.Str(id) + ",\"name\":" + Json.Str(d.Name) +
                    ",\"kind\":" + Json.Str(KindName(a.PairingKind)) + ",\"pin\":" + Json.Str(a.Pin ?? "") + "}");
                tcs.Task.ContinueWith(t =>
                {
                    try
                    {
                        var r = t.Result;
                        if (r[0] == "1")
                        {
                            if (a.PairingKind == DevicePairingKinds.ProvidePin) a.Accept(r[1]); else a.Accept();
                        }
                    }
                    catch { /* declined */ }
                    deferral.Complete();
                });
            };
            custom.PairingRequested += onRequest;
            try
            {
                var kinds = DevicePairingKinds.ConfirmOnly | DevicePairingKinds.DisplayPin | DevicePairingKinds.ConfirmPinMatch | DevicePairingKinds.ProvidePin;
                var res = await W.A(custom.PairAsync(kinds));
                bool ok = res.Status == DevicePairingResultStatus.Paired || res.Status == DevicePairingResultStatus.AlreadyPaired;
                return "{\"status\":" + Json.Str(res.Status.ToString()) + ",\"paired\":" + Json.Bool(ok) + "}";
            }
            finally
            {
                custom.PairingRequested -= onRequest;
                lock (replies) replies.Remove(id);
            }
        }

        public static async Task<string> Unpair(string id)
        {
            var d = await W.A(DeviceInformation.CreateFromIdAsync(id, Props, DeviceInformationKind.AssociationEndpoint));
            var r = await W.A(d.Pairing.UnpairAsync());
            bool ok = r.Status == DeviceUnpairingResultStatus.Unpaired || r.Status == DeviceUnpairingResultStatus.AlreadyUnpaired;
            return "{\"status\":" + Json.Str(r.Status.ToString()) + ",\"ok\":" + Json.Bool(ok) + "}";
        }
    }

    static class Wifi
    {
        static WiFiAdapter adapter;

        static async Task<WiFiAdapter> Adapter()
        {
            if (adapter != null) return adapter;
            var access = await W.A(WiFiAdapter.RequestAccessAsync());
            if (access != WiFiAccessStatus.Allowed) throw new Exception("Windows didn't allow Wi-Fi access (" + access + "). Check Settings › Privacy › Location.");
            var list = await W.A(WiFiAdapter.FindAllAdaptersAsync());
            if (list.Count == 0) throw new Exception("No Wi-Fi adapter");
            adapter = list[0];
            return adapter;
        }

        static async Task<string> ConnectedSsid(WiFiAdapter a)
        {
            var p = await W.A(a.NetworkAdapter.GetConnectedProfileAsync());
            if (p == null) return null;
            try { if (p.IsWlanConnectionProfile) return p.WlanConnectionProfileDetails.GetConnectedSsid(); } catch { /* fall through */ }
            return p.ProfileName;
        }

        static bool Secure(WiFiAvailableNetwork n)
        {
            var t = n.SecuritySettings.NetworkAuthenticationType;
            return t != NetworkAuthenticationType.Open80211 && t != NetworkAuthenticationType.None && t.ToString() != "Owe";
        }

        public static async Task<string> Scan(bool rescan)
        {
            WiFiAdapter a;
            try { a = await Adapter(); }
            catch (Exception e) { return "{\"available\":false,\"error\":" + Json.Str(e.Message) + ",\"networks\":[]}"; }
            if (rescan) { try { await W.A(a.ScanAsync()); } catch { /* use the last report */ } }
            string cur = await ConnectedSsid(a);
            var best = new Dictionary<string, WiFiAvailableNetwork>();
            foreach (var n in a.NetworkReport.AvailableNetworks)
            {
                if (string.IsNullOrEmpty(n.Ssid)) continue;
                WiFiAvailableNetwork b;
                if (!best.TryGetValue(n.Ssid, out b) || n.NetworkRssiInDecibelMilliwatts > b.NetworkRssiInDecibelMilliwatts) best[n.Ssid] = n;
            }
            var items = best.Values
                .OrderByDescending(n => n.Ssid == cur)
                .ThenByDescending(n => n.NetworkRssiInDecibelMilliwatts)
                .Select(n => "{\"ssid\":" + Json.Str(n.Ssid) + ",\"bars\":" + n.SignalBars +
                    ",\"rssi\":" + ((int)n.NetworkRssiInDecibelMilliwatts).ToString(CultureInfo.InvariantCulture) +
                    ",\"secure\":" + Json.Bool(Secure(n)) + ",\"auth\":" + Json.Str(n.SecuritySettings.NetworkAuthenticationType.ToString()) +
                    ",\"ghz\":" + (n.ChannelCenterFrequencyInKilohertz / 1000000.0).ToString("0.#", CultureInfo.InvariantCulture) + "}");
            return "{\"available\":true,\"connected\":" + Json.Str(cur) + ",\"networks\":[" + string.Join(",", items) + "]}";
        }

        public static async Task<string> Connect(string ssid, string password, bool auto)
        {
            var a = await Adapter();
            Func<WiFiAvailableNetwork> pick = () =>
            {
                WiFiAvailableNetwork net = null;
                foreach (var n in a.NetworkReport.AvailableNetworks)
                    if (n.Ssid == ssid && (net == null || n.NetworkRssiInDecibelMilliwatts > net.NetworkRssiInDecibelMilliwatts)) net = n;
                return net;
            };
            var target = pick();
            if (target == null) { await W.A(a.ScanAsync()); target = pick(); }
            if (target == null) throw new Exception(ssid + " isn't in range");
            var kind = auto ? WiFiReconnectionKind.Automatic : WiFiReconnectionKind.Manual;
            WiFiConnectionResult r;
            if (!string.IsNullOrEmpty(password))
            {
                var cred = new PasswordCredential();
                cred.Password = password;
                r = await W.A(a.ConnectAsync(target, kind, cred));
            }
            else
            {
                r = await W.A(a.ConnectAsync(target, kind));
            }
            return "{\"status\":" + Json.Str(r.ConnectionStatus.ToString()) + ",\"ok\":" + Json.Bool(r.ConnectionStatus == WiFiConnectionStatus.Success) + "}";
        }

        public static async Task<string> Disconnect()
        {
            var a = await Adapter();
            a.Disconnect();
            return "true";
        }
    }
}
