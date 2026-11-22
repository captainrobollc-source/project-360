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
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Enumeration;
using Windows.Devices.Enumeration.Pnp;
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
                case "bt.audio.list": return BtAudio.List();
                case "bt.battery": return await Battery.Read();
                case "bt.audio.connect": return BtAudio.Connect(Arg(p, 2), Arg(p, 3), Arg(p, 4) != "0");
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
            long lastChange = Environment.TickCount;
            var w = DeviceInformation.CreateWatcher(Selector(true), Props, DeviceInformationKind.AssociationEndpoint);
            w.Added += (s, d) => { lock (list) list[d.Id] = d; Interlocked.Exchange(ref lastChange, Environment.TickCount); };
            w.Updated += (s, u) => { lock (list) { DeviceInformation d; if (list.TryGetValue(u.Id, out d)) d.Update(u); } Interlocked.Exchange(ref lastChange, Environment.TickCount); };
            w.Removed += (s, u) => { lock (list) list.Remove(u.Id); };
            w.EnumerationCompleted += (s, o) => done.TrySetResult(true);
            int start = Environment.TickCount;
            w.Start();
            // Known devices arrive straight from the cache: stop once they've been quiet for 350 ms
            // (at least 300 ms in, at most 2 s).
            while (!done.Task.IsCompleted)
            {
                await Task.Delay(50);
                int now = Environment.TickCount;
                if (now - start >= 2000) break;
                if (now - start >= 300 && now - Interlocked.Read(ref lastChange) >= 350) break;
            }
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
                w.Stopped += (s, o) =>
                {
                    lock (scanLock) { if (watcher != null && watcher != s) return; }
                    Program.Emit("{\"ev\":\"bt.scanDone\"}");
                };
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

    // ---- Bluetooth audio: connect / disconnect paired headphones and speakers.
    // Windows only reconnects audio devices when they ask (AirPods busy with a phone never do).
    // Settings' "Connect" button sends a one-shot reconnect (KSPROPSETID_BtAudio) to the device's
    // Bluetooth audio driver; this does the same. Each device's audio endpoints (Stereo and
    // Hands-Free) lead to its driver filters through the endpoint's device topology.
    static class BtAudio
    {
        [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
        [StructLayout(LayoutKind.Explicit, Size = 24)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }
        [StructLayout(LayoutKind.Sequential)] struct KSPROPERTY { public Guid Set; public int Id; public int Flags; }

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
            [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        }

        [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceCollection
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int Item(int index, out IMMDevice device);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
            [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
            [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
            [PreserveSig] int GetState(out int state);
        }

        [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IPropertyStore
        {
            [PreserveSig] int GetCount(out int count);
            [PreserveSig] int GetAt(int index, out PROPERTYKEY key);
            [PreserveSig] int GetValue(ref PROPERTYKEY key, out PROPVARIANT value);
        }

        [ComImport, Guid("2A07407E-6497-4A18-9787-32F79BD0D98F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IDeviceTopology
        {
            [PreserveSig] int GetConnectorCount(out int count);
            [PreserveSig] int GetConnector(int index, out IConnector connector);
        }

        [ComImport, Guid("9c2c4058-23f5-41de-877a-df3af236a09e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IConnector
        {
            [PreserveSig] int GetConnectorType(out int type);
            [PreserveSig] int GetDataFlow(out int flow);
            [PreserveSig] int ConnectTo(IntPtr to);
            [PreserveSig] int Disconnect();
            [PreserveSig] int IsConnected(out int connected);
            [PreserveSig] int GetConnectedTo(out IntPtr to);
            [PreserveSig] int GetConnectorIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string id);
            [PreserveSig] int GetDeviceIdConnectedTo([MarshalAs(UnmanagedType.LPWStr)] out string id);
        }

        [ComImport, Guid("28F54685-06FD-11D2-B27A-00A0C9223196"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IKsControl
        {
            [PreserveSig] int KsProperty(ref KSPROPERTY prop, int propLength, IntPtr data, int dataLength, out int returned);
        }

        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);

        static readonly Guid CLSID_MMDeviceEnumerator = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
        static readonly Guid IID_IDeviceTopology = new Guid("2A07407E-6497-4A18-9787-32F79BD0D98F");
        static readonly Guid IID_IKsControl = new Guid("28F54685-06FD-11D2-B27A-00A0C9223196");
        static readonly Guid KSPROPSETID_BtAudio = new Guid("7FA06C40-B8F6-4C7E-8556-E8C33A12E54D");
        const int KSPROPERTY_ONESHOT_RECONNECT = 0, KSPROPERTY_ONESHOT_DISCONNECT = 1, KSPROPERTY_TYPE_GET = 1;
        const int CLSCTX_ALL = 23, DEVICE_STATE_ACTIVE = 1, DEVICE_STATEMASK_ALL = 15;

        static PROPERTYKEY Key(string g, int pid) { var k = new PROPERTYKEY(); k.fmtid = new Guid(g); k.pid = pid; return k; }
        static readonly PROPERTYKEY PKEY_Device_FriendlyName = Key("a45c254e-df1c-4efd-8020-67d146a850e0", 14);
        static readonly PROPERTYKEY PKEY_DeviceInterface_FriendlyName = Key("026e516e-b814-414b-83cd-856d6fef4822", 2);
        static readonly PROPERTYKEY PKEY_Device_ContainerId = Key("8c7ed206-3f8a-4827-b3ab-ae9e1faefc6c", 2);

        public class Group { public string Container, Mac, Name; public int Vid, Pid; public bool Connected; public List<string> Filters = new List<string>(); }

        public static List<Group> All() { return Groups(Enumerator()); }

        // ..._VID&0001004C_PID&2024\... → (0x004C, 0x2024)
        static void VidPid(string filterId, out int vid, out int pid)
        {
            vid = pid = 0;
            var m = System.Text.RegularExpressions.Regex.Match(filterId ?? "", @"vid&([0-9a-f]{8})_pid&([0-9a-f]{4})", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if (!m.Success) return;
            vid = Convert.ToInt32(m.Groups[1].Value.Substring(4), 16);
            pid = Convert.ToInt32(m.Groups[2].Value, 16);
        }

        static string StrProp(IPropertyStore st, PROPERTYKEY k)
        {
            PROPVARIANT pv;
            if (st.GetValue(ref k, out pv) != 0) return null;
            try { return pv.vt == 31 && pv.p != IntPtr.Zero ? Marshal.PtrToStringUni(pv.p) : null; }
            finally { PropVariantClear(ref pv); }
        }

        static string GuidProp(IPropertyStore st, PROPERTYKEY k)
        {
            PROPVARIANT pv;
            if (st.GetValue(ref k, out pv) != 0) return null;
            try { return pv.vt == 72 && pv.p != IntPtr.Zero ? ((Guid)Marshal.PtrToStructure(pv.p, typeof(Guid))).ToString("D") : null; }
            finally { PropVariantClear(ref pv); }
        }

        // "AirPods Pro Hands-Free" / "AirPods Pro Stereo" → "AirPods Pro"
        static string CleanName(string n)
        {
            if (string.IsNullOrEmpty(n)) return null;
            n = n.Trim();
            var m = System.Text.RegularExpressions.Regex.Match(n, @"^\w[\w ]*\((.+)\)$");
            if (m.Success) n = m.Groups[1].Value.Trim(); // "Headphones (AirPods Pro)"
            foreach (var s in new[] { " Hands-Free AG Audio", " Hands-Free AG", " Hands-Free", " Stereo", " Avrcp Transport" })
                if (n.EndsWith(s, StringComparison.OrdinalIgnoreCase)) n = n.Substring(0, n.Length - s.Length).Trim();
            return n;
        }

        // Classic Bluetooth audio filters carry the device address: ...&0&A1B2C3D4E5F6_C00000000#...
        static string MacOf(string filterId)
        {
            var m = System.Text.RegularExpressions.Regex.Match(filterId ?? "", @"[&#]([0-9a-fA-F]{12})_[cC][0-9a-fA-F]+");
            if (!m.Success) return null;
            string h = m.Groups[1].Value.ToLowerInvariant();
            return string.Join(":", Enumerable.Range(0, 6).Select(i => h.Substring(i * 2, 2)));
        }

        static IMMDeviceEnumerator Enumerator() { return (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_MMDeviceEnumerator)); }

        static List<Group> Groups(IMMDeviceEnumerator en)
        {
            var byKey = new Dictionary<string, Group>();
            IMMDeviceCollection col;
            if (en.EnumAudioEndpoints(2 /*eAll*/, DEVICE_STATEMASK_ALL, out col) != 0) return new List<Group>();
            int count; col.GetCount(out count);
            for (int i = 0; i < count; i++)
            {
                try
                {
                    IMMDevice ep;
                    if (col.Item(i, out ep) != 0) continue;
                    Guid iid = IID_IDeviceTopology;
                    object o;
                    if (ep.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o) != 0) continue;
                    var topo = (IDeviceTopology)o;
                    IConnector conn;
                    if (topo.GetConnector(0, out conn) != 0) continue;
                    string filter;
                    if (conn.GetDeviceIdConnectedTo(out filter) != 0 || filter == null) continue;
                    string lower = filter.ToLowerInvariant();
                    if (!lower.Contains("bthenum") && !lower.Contains("bthhfenum") && !lower.Contains("bthleenum")) continue;
                    int state; ep.GetState(out state);
                    string container = null, name = null;
                    IPropertyStore st;
                    if (ep.OpenPropertyStore(0, out st) == 0)
                    {
                        container = GuidProp(st, PKEY_Device_ContainerId);
                        name = CleanName(StrProp(st, PKEY_DeviceInterface_FriendlyName)) ?? CleanName(StrProp(st, PKEY_Device_FriendlyName));
                    }
                    string mac = MacOf(filter);
                    string key = container ?? mac ?? (name ?? filter).ToLowerInvariant();
                    Group g;
                    if (!byKey.TryGetValue(key, out g)) { g = new Group { Container = container }; byKey[key] = g; }
                    if (g.Mac == null) g.Mac = mac;
                    if (g.Pid == 0) { int vid, pid; VidPid(filter, out vid, out pid); g.Vid = vid; g.Pid = pid; }
                    if (g.Name == null || (name != null && name.Length < g.Name.Length)) g.Name = name ?? g.Name;
                    if (state == DEVICE_STATE_ACTIVE) g.Connected = true;
                    if (!g.Filters.Contains(filter)) g.Filters.Add(filter);
                }
                catch { /* an endpoint that can't be inspected */ }
            }
            return byKey.Values.ToList();
        }

        static string GroupJson(Group g)
        {
            return "{\"container\":" + Json.Str(g.Container) + ",\"mac\":" + Json.Str(g.Mac) + ",\"name\":" + Json.Str(g.Name) +
                ",\"connected\":" + Json.Bool(g.Connected) + ",\"filters\":" + g.Filters.Count + "}";
        }

        public static string List()
        {
            return "[" + string.Join(",", Groups(Enumerator()).Select(GroupJson)) + "]";
        }

        // Finds the device by Bluetooth address (or by name when the address isn't in the driver's
        // id) and asks each of its audio drivers to connect or disconnect.
        public static string Connect(string mac, string name, bool on)
        {
            var en = Enumerator();
            var groups = Groups(en);
            string m = (mac ?? "").ToLowerInvariant();
            string n = CleanName(name);
            var g = groups.FirstOrDefault(x => m != "" && x.Mac == m)
                ?? groups.FirstOrDefault(x => n != null && string.Equals(x.Name, n, StringComparison.OrdinalIgnoreCase));
            if (g == null) return "{\"found\":false,\"sent\":0}";
            int sent = 0;
            var errors = new List<string>();
            foreach (var filter in g.Filters)
            {
                try
                {
                    IMMDevice dev;
                    int hr = en.GetDevice(filter, out dev);
                    if (hr != 0) { errors.Add("device 0x" + hr.ToString("x8")); continue; }
                    Guid iid = IID_IKsControl;
                    object o;
                    hr = dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o);
                    if (hr != 0) { errors.Add("control 0x" + hr.ToString("x8")); continue; }
                    var ks = (IKsControl)o;
                    var prop = new KSPROPERTY { Set = KSPROPSETID_BtAudio, Id = on ? KSPROPERTY_ONESHOT_RECONNECT : KSPROPERTY_ONESHOT_DISCONNECT, Flags = KSPROPERTY_TYPE_GET };
                    int ret;
                    hr = ks.KsProperty(ref prop, Marshal.SizeOf(typeof(KSPROPERTY)), IntPtr.Zero, 0, out ret);
                    if (hr == 0) sent++; else errors.Add("request 0x" + hr.ToString("x8"));
                }
                catch (Exception e) { errors.Add(e.Message); }
            }
            return "{\"found\":true,\"sent\":" + sent + ",\"filters\":" + g.Filters.Count + ",\"connected\":" + Json.Bool(g.Connected) +
                ",\"errors\":[" + string.Join(",", errors.Select(Json.Str)) + "]}";
        }
    }

    // ---- Battery for Bluetooth audio devices.
    //  * AirPods / Beats: their Bluetooth LE "proximity" broadcasts (what an iPhone's battery pop-up
    //    reads) carry left, right and case battery in 10% steps. They're sent while the buds are out
    //    or the case is open, even when connected to a phone. Matched to a paired device by Apple
    //    model number (the PID in the device's driver id), strongest signal first.
    //  * Anything else: the level Windows reads over Hands-Free while the device is connected.
    static class Battery
    {
        class Apple { public int Model; public int? Left, Right, Case; public bool ChL, ChR, ChCase; public short Rssi; public int At; }
        static readonly Dictionary<int, Apple> seen = new Dictionary<int, Apple>(); // model → best recent reading
        static BluetoothLEAdvertisementWatcher watcher;
        static int lastAsk;
        static Timer idle;

        static int? Pct(int n) { return n <= 10 ? (int?)(n * 10) : null; } // 15 = not reported

        static void EnsureWatcher()
        {
            lock (seen)
            {
                lastAsk = Environment.TickCount;
                if (watcher != null && (watcher.Status == BluetoothLEAdvertisementWatcherStatus.Started || watcher.Status == BluetoothLEAdvertisementWatcherStatus.Created)) {
                    if (watcher.Status == BluetoothLEAdvertisementWatcherStatus.Created) { try { watcher.Start(); } catch { } }
                    return;
                }
                if (watcher != null) watcher.Received -= OnAdvert;
                watcher = new BluetoothLEAdvertisementWatcher { ScanningMode = BluetoothLEScanningMode.Passive };
                watcher.Received += OnAdvert;
                try { watcher.Start(); } catch { /* Bluetooth off */ }
                // Listening costs a little power: stop a minute after the last question.
                if (idle == null) idle = new Timer(_ =>
                {
                    lock (seen)
                    {
                        if (watcher != null && Environment.TickCount - lastAsk > 60000 && watcher.Status == BluetoothLEAdvertisementWatcherStatus.Started) { try { watcher.Stop(); } catch { } }
                    }
                }, null, 15000, 15000);
            }
        }

        static void OnAdvert(BluetoothLEAdvertisementWatcher w, BluetoothLEAdvertisementReceivedEventArgs args)
        {
            try
            {
                foreach (var md in args.Advertisement.ManufacturerData)
                {
                    if (md.CompanyId != 0x004C) continue;
                    var buf = md.Data;
                    byte[] d = new byte[buf.Length];
                    Windows.Storage.Streams.DataReader.FromBuffer(buf).ReadBytes(d);
                    if (d.Length < 8 || d[0] != 0x07) continue; // 0x07 = proximity pairing (AirPods, Beats)
                    int model = d[3] | (d[4] << 8);             // 0x0E 0x20 → 0x200E
                    bool flip = (d[5] & 0x20) == 0;              // which bud is reported first
                    int hi = d[6] >> 4, lo = d[6] & 0xF, charge = d[7] >> 4;
                    var a = new Apple
                    {
                        Model = model, Left = Pct(flip ? hi : lo), Right = Pct(flip ? lo : hi), Case = Pct(d[7] & 0xF),
                        ChL = (charge & (flip ? 2 : 1)) != 0, ChR = (charge & (flip ? 1 : 2)) != 0, ChCase = (charge & 4) != 0,
                        Rssi = args.RawSignalStrengthInDBm, At = Environment.TickCount,
                    };
                    lock (seen)
                    {
                        // Several of the same model nearby: the strongest signal (closest) wins; a
                        // reading older than 10 s gives way to anything.
                        Apple prev;
                        if (!seen.TryGetValue(model, out prev) || a.Rssi >= prev.Rssi - 6 || a.At - prev.At > 10000) seen[model] = a;
                    }
                }
            }
            catch { /* malformed advertisement */ }
        }

        static async Task<int?> WindowsLevel(string container)
        {
            if (string.IsNullOrEmpty(container)) return null;
            const string key = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2"; // Bluetooth battery level
            var list = await W.A(PnpObject.FindAllAsync(PnpObjectType.Device, new[] { key }, "System.Devices.ContainerId:=\"{" + container + "}\""));
            foreach (var o in list)
            {
                object v;
                if (!o.Properties.TryGetValue(key, out v) || v == null) continue;
                try { int n = Convert.ToInt32(v); if (n >= 0 && n <= 100) return n; } catch { /* not a number */ }
            }
            return null;
        }

        static string AppleJson(Apple a)
        {
            return "{\"left\":" + Json.Num(a.Left) + ",\"right\":" + Json.Num(a.Right) + ",\"case\":" + Json.Num(a.Case) +
                ",\"chargingLeft\":" + Json.Bool(a.ChL) + ",\"chargingRight\":" + Json.Bool(a.ChR) + ",\"chargingCase\":" + Json.Bool(a.ChCase) +
                ",\"rssi\":" + a.Rssi + ",\"age\":" + (Environment.TickCount - a.At) + "}";
        }

        public static async Task<string> Read()
        {
            bool fresh;
            lock (seen) fresh = watcher != null && watcher.Status == BluetoothLEAdvertisementWatcherStatus.Started && seen.Values.Any(x => Environment.TickCount - x.At < 30000);
            EnsureWatcher();
            if (!fresh) await Task.Delay(2500); // broadcasts arrive several times a second
            var parts = new List<string>();
            foreach (var g in BtAudio.All())
            {
                int? win = null;
                try { win = await WindowsLevel(g.Container); } catch { /* unknown */ }
                Apple a = null;
                if (g.Vid == 0x004C && g.Pid != 0)
                {
                    lock (seen) { Apple x; if (seen.TryGetValue(g.Pid, out x) && Environment.TickCount - x.At < 60000) a = x; }
                }
                parts.Add("{\"mac\":" + Json.Str(g.Mac) + ",\"name\":" + Json.Str(g.Name) + ",\"level\":" + Json.Num(win) +
                    ",\"apple\":" + (a == null ? "null" : AppleJson(a)) + "}");
            }
            return "[" + string.Join(",", parts) + "]";
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
