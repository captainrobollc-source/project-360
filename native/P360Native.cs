// Project 360 native helper.
// Compiled with the in-box .NET Framework compiler (C# 5): see scripts/build-native.js
//
// Protocol (stdio, UTF-8, one message per line)
//   stdin : <id>\t<command>\t<arg1>\t<arg2>...
//   stdout: {"id":N,"ok":true,"result":...}            (responses)
//           {"ev":"in","s":0,"b":1234}                 (virtual button mask changed)
//           {"ev":"pad","s":0,"c":true}                (controller connected/disconnected)
//           {"ev":"bat","s":0,"type":2,"lvl":3}        (battery info)
//           {"ev":"guide","src":"dinput","s":4}        (PlayStation button on a DirectInput pad)
//
// Virtual button bits (mirrors XInput wButtons + extras):
//   0 up 1 down 2 left 3 right 4 start 5 back 6 ls 7 rs 8 lb 9 rb 10 guide
//   12 a 13 b 14 x 15 y 16 lt 17 rt
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace P360
{
    static class Program
    {
        static readonly object OutLock = new object();
        static TextWriter Out;

        static void Main(string[] args)
        {
            var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            stdout.AutoFlush = true;
            Out = stdout;
            var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));

            XInput.Init();
            var padThread = new Thread(Pads.Loop);
            padThread.IsBackground = true;
            padThread.Start();

            Emit("{\"ev\":\"ready\",\"xinput\":" + Json.Str(XInput.DllName) + ",\"guide\":" + Json.Bool(XInput.HasGuide) + "}");

            string line;
            while ((line = stdin.ReadLine()) != null)
            {
                if (line.Length == 0) continue;
                string[] parts = line.Split('\t');
                string id = parts[0];
                try
                {
                    string result = Dispatch(parts);
                    Emit("{\"id\":" + id + ",\"ok\":true,\"result\":" + result + "}");
                }
                catch (Exception ex)
                {
                    Emit("{\"id\":" + id + ",\"ok\":false,\"error\":" + Json.Str(ex.Message) + "}");
                }
            }
            // Parent went away (quit or crash): never leave the taskbar hidden or keys held.
            Taskbar.Show();
            Emu.Deactivate();
            Environment.Exit(0);
        }

        public static void Emit(string json)
        {
            lock (OutLock)
            {
                try { Out.WriteLine(json); } catch { Environment.Exit(0); }
            }
        }

        static string Arg(string[] p, int i) { return p.Length > i ? p[i] : ""; }

        static string Dispatch(string[] p)
        {
            string cmd = Arg(p, 1);
            switch (cmd)
            {
                case "ping": return "\"pong\"";
                case "vol.get": return Audio.GetVolumeJson();
                case "vol.set": Audio.SetVolume(float.Parse(Arg(p, 2), System.Globalization.CultureInfo.InvariantCulture)); return Audio.GetVolumeJson();
                case "vol.mute": Audio.SetMute(Arg(p, 2) == "1"); return Audio.GetVolumeJson();
                case "audio.list": return Audio.ListJson();
                case "audio.setDefault": Audio.SetDefault(Arg(p, 2)); return Audio.ListJson();
                case "procs.find": return Procs.FindJson(Arg(p, 2), Arg(p, 3));
                case "wins.find": return Win.FindWindowsJson(Procs.MatchPids(Arg(p, 2), Arg(p, 3)));
                case "wins.close": return Win.ClosePids(Arg(p, 2)).ToString();
                case "wins.bypid":
                {
                    var map = new Dictionary<int, string>();
                    foreach (string s in Arg(p, 2).Split('|'))
                    {
                        int pid;
                        if (!int.TryParse(s, out pid)) continue;
                        map[pid] = Procs.PathOf(pid) ?? "";
                    }
                    return Win.FindWindowsJson(map);
                }
                case "taskbar.hide": Taskbar.Hide(); return "true";
                case "taskbar.show": Taskbar.Show(); return "true";
                case "wins.hide": return Json.Bool(Win.HideWindow(new IntPtr(long.Parse(Arg(p, 2)))));
                case "wins.alive": return Json.Bool(Win.Alive(new IntPtr(long.Parse(Arg(p, 2)))));
                case "wins.bottom": return Json.Bool(Win.SendToBottom(new IntPtr(long.Parse(Arg(p, 2)))));
                case "emu.on": Emu.Activate(); return "true";
                case "emu.off": Emu.Deactivate(); return "true";
                case "focus.hwnd": return Json.Bool(Win.ForceForeground(new IntPtr(long.Parse(Arg(p, 2)))));
                case "focus.pids": return Json.Bool(Win.FocusPids(Arg(p, 2)));
                case "power.sleep": return Json.Bool(Win.SetSuspendState(false, false, false));
                case "pad.rumble": XInput.Rumble(int.Parse(Arg(p, 2)), int.Parse(Arg(p, 3)), int.Parse(Arg(p, 4)), int.Parse(Arg(p, 5))); return "true";
                case "pad.battery": Pads.ForceBattery = true; return "true";
                default: throw new Exception("unknown command " + cmd);
            }
        }
    }

    static class Json
    {
        public static string Bool(bool b) { return b ? "true" : "false"; }
        public static string Str(string s)
        {
            if (s == null) return "null";
            var sb = new StringBuilder(s.Length + 2);
            sb.Append('"');
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
                        if (c < 0x20) sb.Append("\\u" + ((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }
        public static string Num(double d) { return d.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture); }
    }

    // ------------------------------------------------------------------ XInput
    [StructLayout(LayoutKind.Sequential)]
    struct XINPUT_GAMEPAD
    {
        public ushort wButtons;
        public byte bLeftTrigger;
        public byte bRightTrigger;
        public short sThumbLX;
        public short sThumbLY;
        public short sThumbRX;
        public short sThumbRY;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct XINPUT_STATE
    {
        public uint dwPacketNumber;
        public XINPUT_GAMEPAD Gamepad;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct XINPUT_VIBRATION
    {
        public ushort wLeftMotorSpeed;
        public ushort wRightMotorSpeed;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct XINPUT_BATTERY_INFORMATION
    {
        public byte BatteryType;
        public byte BatteryLevel;
    }

    static class XInput
    {
        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        public delegate uint GetStateFn(uint idx, out XINPUT_STATE state);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        public delegate uint SetStateFn(uint idx, ref XINPUT_VIBRATION vib);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        public delegate uint GetBatteryFn(uint idx, byte devType, out XINPUT_BATTERY_INFORMATION info);

        [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern IntPtr LoadLibrary(string name);
        [DllImport("kernel32", CharSet = CharSet.Ansi)]
        static extern IntPtr GetProcAddress(IntPtr mod, string name);
        [DllImport("kernel32", EntryPoint = "GetProcAddress")]
        static extern IntPtr GetProcAddressOrdinal(IntPtr mod, IntPtr ordinal);

        public static GetStateFn GetState;
        public static SetStateFn SetState;
        public static GetBatteryFn GetBattery;
        public static string DllName = null;
        public static bool HasGuide = false;

        public static void Init()
        {
            string[] dlls = { "xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll" };
            foreach (string dll in dlls)
            {
                IntPtr mod = LoadLibrary(dll);
                if (mod == IntPtr.Zero) continue;
                DllName = dll;
                // XInputGetStateEx (ordinal 100) exposes the Guide button.
                IntPtr ex = GetProcAddressOrdinal(mod, new IntPtr(100));
                IntPtr std = GetProcAddress(mod, "XInputGetState");
                if (ex != IntPtr.Zero) { GetState = (GetStateFn)Marshal.GetDelegateForFunctionPointer(ex, typeof(GetStateFn)); HasGuide = true; }
                else if (std != IntPtr.Zero) GetState = (GetStateFn)Marshal.GetDelegateForFunctionPointer(std, typeof(GetStateFn));
                IntPtr set = GetProcAddress(mod, "XInputSetState");
                if (set != IntPtr.Zero) SetState = (SetStateFn)Marshal.GetDelegateForFunctionPointer(set, typeof(SetStateFn));
                IntPtr bat = GetProcAddress(mod, "XInputGetBatteryInformation");
                if (bat != IntPtr.Zero) GetBattery = (GetBatteryFn)Marshal.GetDelegateForFunctionPointer(bat, typeof(GetBatteryFn));
                if (GetState != null) return;
            }
        }

        public static void Rumble(int slot, int left, int right, int ms)
        {
            if (SetState == null) return;
            var v = new XINPUT_VIBRATION();
            v.wLeftMotorSpeed = (ushort)Math.Max(0, Math.Min(65535, left));
            v.wRightMotorSpeed = (ushort)Math.Max(0, Math.Min(65535, right));
            SetState((uint)slot, ref v);
            var t = new Thread(delegate ()
            {
                Thread.Sleep(Math.Max(10, Math.Min(2000, ms)));
                var z = new XINPUT_VIBRATION();
                SetState((uint)slot, ref z);
            });
            t.IsBackground = true;
            t.Start();
        }
    }

    // ------------------------------------------------------------- WinMM (DirectInput HID pads)
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct JOYCAPS
    {
        public ushort wMid;
        public ushort wPid;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
        public uint wXmin, wXmax, wYmin, wYmax, wZmin, wZmax, wNumButtons, wPeriodMin, wPeriodMax;
        public uint wRmin, wRmax, wUmin, wUmax, wVmin, wVmax, wCaps, wMaxAxes, wNumAxes, wMaxButtons;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szRegKey;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szOEMVxD;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOYINFOEX
    {
        public int dwSize, dwFlags, dwXpos, dwYpos, dwZpos, dwRpos, dwUpos, dwVpos, dwButtons, dwButtonNumber, dwPOV, dwReserved1, dwReserved2;
    }

    static class Pads
    {
        [DllImport("winmm.dll")] static extern int joyGetNumDevs();
        [DllImport("winmm.dll", CharSet = CharSet.Unicode)] static extern int joyGetDevCaps(int id, ref JOYCAPS caps, int size);
        [DllImport("winmm.dll")] static extern int joyGetPosEx(int id, ref JOYINFOEX info);
        [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint p);

        public static volatile bool ForceBattery = false;

        const int StickPress = 16000;   // ~0.49
        const int StickRelease = 11000; // ~0.34 (hysteresis)
        const int TriggerPress = 110;
        const int TriggerRelease = 60;

        public static void Loop()
        {
            timeBeginPeriod(1);
            bool[] connected = new bool[4];
            int[] masks = new int[4];
            int[] stickDir = new int[4];
            bool[] lt = new bool[4], rt = new bool[4];
            int[] lastBat = new int[4];
            for (int i = 0; i < 4; i++) lastBat[i] = -1;
            var batWatch = Stopwatch.StartNew();
            long nextBat = 0;
            int disconnectedProbe = 0;

            // Sony DirectInput pads (PS button = button 13 / bit 12) via WinMM, for the in-game Guide.
            var sony = new List<int>();
            var sonyDown = new Dictionary<int, bool>();
            long nextJoyScan = 0;

            while (true)
            {
                if (XInput.GetState != null)
                {
                    disconnectedProbe = (disconnectedProbe + 1) % 60;
                    for (int s = 0; s < 4; s++)
                    {
                        // Polling an empty slot is slow; only re-probe disconnected slots ~every 0.5s.
                        if (!connected[s] && disconnectedProbe != s * 15) continue;
                        XINPUT_STATE st;
                        uint r = XInput.GetState((uint)s, out st);
                        bool now = r == 0;
                        if (now != connected[s])
                        {
                            connected[s] = now;
                            Program.Emit("{\"ev\":\"pad\",\"s\":" + s + ",\"c\":" + Json.Bool(now) + "}");
                            if (!now) { masks[s] = 0; Program.Emit("{\"ev\":\"in\",\"s\":" + s + ",\"b\":0}"); lastBat[s] = -1; }
                            else nextBat = 0;
                        }
                        if (!now) continue;

                        var g = st.Gamepad;
                        int mask = g.wButtons & 0xF7FF;

                        // Left stick -> d-pad (dominant axis, with hysteresis).
                        int ax = g.sThumbLX, ay = g.sThumbLY;
                        int dir = stickDir[s];
                        int mag = Math.Max(Math.Abs(ax), Math.Abs(ay));
                        if (dir != 0 && mag < StickRelease) dir = 0;
                        if (mag > StickPress)
                        {
                            if (Math.Abs(ax) > Math.Abs(ay)) dir = ax > 0 ? 0x8 : 0x4;
                            else dir = ay > 0 ? 0x1 : 0x2;
                        }
                        stickDir[s] = dir;
                        mask |= dir;

                        if (!lt[s] && g.bLeftTrigger > TriggerPress) lt[s] = true;
                        else if (lt[s] && g.bLeftTrigger < TriggerRelease) lt[s] = false;
                        if (!rt[s] && g.bRightTrigger > TriggerPress) rt[s] = true;
                        else if (rt[s] && g.bRightTrigger < TriggerRelease) rt[s] = false;
                        if (lt[s]) mask |= 1 << 16;
                        if (rt[s]) mask |= 1 << 17;

                        Emu.Seen(s, g.wButtons);
                        if (Emu.Active) Emu.Process(s, g);

                        if (mask != masks[s])
                        {
                            masks[s] = mask;
                            Program.Emit("{\"ev\":\"in\",\"s\":" + s + ",\"b\":" + mask + "}");
                        }
                    }

                    if (XInput.GetBattery != null && (batWatch.ElapsedMilliseconds >= nextBat || ForceBattery))
                    {
                        bool force = ForceBattery;
                        ForceBattery = false;
                        nextBat = batWatch.ElapsedMilliseconds + 15000;
                        for (int s = 0; s < 4; s++)
                        {
                            if (!connected[s]) continue;
                            XINPUT_BATTERY_INFORMATION bi;
                            if (XInput.GetBattery((uint)s, 0, out bi) != 0) continue;
                            int key = bi.BatteryType * 16 + bi.BatteryLevel;
                            if (key != lastBat[s] || force)
                            {
                                lastBat[s] = key;
                                Program.Emit("{\"ev\":\"bat\",\"s\":" + s + ",\"type\":" + bi.BatteryType + ",\"lvl\":" + bi.BatteryLevel + "}");
                            }
                        }
                    }
                }

                // DirectInput (Sony) guide detection.
                try
                {
                    if (batWatch.ElapsedMilliseconds >= nextJoyScan)
                    {
                        nextJoyScan = batWatch.ElapsedMilliseconds + 4000;
                        sony.Clear();
                        int n = joyGetNumDevs();
                        for (int j = 0; j < Math.Min(n, 16); j++)
                        {
                            var caps = new JOYCAPS();
                            if (joyGetDevCaps(j, ref caps, Marshal.SizeOf(typeof(JOYCAPS))) != 0) continue;
                            if (caps.wMid != 0x054C) continue; // Sony
                            var info = new JOYINFOEX();
                            info.dwSize = Marshal.SizeOf(typeof(JOYINFOEX));
                            info.dwFlags = 0x80; // JOY_RETURNBUTTONS
                            if (joyGetPosEx(j, ref info) == 0) sony.Add(j);
                        }
                    }
                    foreach (int j in sony)
                    {
                        var info = new JOYINFOEX();
                        info.dwSize = Marshal.SizeOf(typeof(JOYINFOEX));
                        info.dwFlags = 0x80;
                        if (joyGetPosEx(j, ref info) != 0) continue;
                        bool down = (info.dwButtons & 0x1000) != 0;
                        bool was;
                        sonyDown.TryGetValue(j, out was);
                        if (down && !was) Program.Emit("{\"ev\":\"guide\",\"src\":\"dinput\",\"s\":" + (4 + j) + "}");
                        sonyDown[j] = down;
                    }
                }
                catch { }

                Thread.Sleep(8);
            }
        }
    }

    // ------------------------------------------------------------- Windows taskbar
    // Hidden while the console is running so it never peeks out during launches.
    // SW_HIDE only (no persistent setting changes); restarting Explorer also brings it back.
    static class Taskbar
    {
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);

        static volatile bool hidden = false;
        static Thread keeper;

        static List<IntPtr> Bars()
        {
            var list = new List<IntPtr>();
            IntPtr main = FindWindow("Shell_TrayWnd", null);
            if (main != IntPtr.Zero) list.Add(main);
            IntPtr prev = IntPtr.Zero;
            while (true)
            {
                prev = FindWindowEx(IntPtr.Zero, prev, "Shell_SecondaryTrayWnd", null);
                if (prev == IntPtr.Zero) break;
                list.Add(prev);
            }
            IntPtr start = FindWindow("Button", "Start"); // legacy floating Start orb
            if (start != IntPtr.Zero) list.Add(start);
            return list;
        }

        public static void Hide()
        {
            hidden = true;
            foreach (var w in Bars()) ShowWindow(w, 0);
            if (keeper != null) return;
            keeper = new Thread(delegate ()
            {
                while (true)
                {
                    Thread.Sleep(1200);
                    if (!hidden) continue;
                    foreach (var w in Bars()) if (IsWindowVisible(w)) ShowWindow(w, 0);
                }
            });
            keeper.IsBackground = true;
            keeper.Start();
        }

        public static void Show()
        {
            if (!hidden) return;
            hidden = false;
            foreach (var w in Bars()) ShowWindow(w, 5 /*SW_SHOW*/);
        }
    }

    // ------------------------------------------------------------- Controller -> mouse/keyboard
    // Used while a desktop/web app (e.g. Firefox kiosk) is in front so it can be driven with a pad.
    //   Left stick: mouse   Right stick: scroll   A: left click   X: right click   B: browser back
    //   Y: space (play/pause)   D-pad: arrows   LB/RB: shift+tab / tab   LT/RT: page up/down
    //   Start: enter   Back: escape   R3: 'f' (player full screen)   L3: middle click
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public INPUTUNION u; }

    static class Emu
    {
        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);

        public static volatile bool Active = false;
        static ushort[] prev = new ushort[4];
        static readonly ushort[] live = new ushort[4];   // buttons physically down right now
        static readonly ushort[] ignore = new ushort[4]; // held when emulation turned on: wait for release
        static double accX, accY, accWheel, accHWheel;
        static readonly Dictionary<int, long> held = new Dictionary<int, long>();
        static readonly Dictionary<int, ushort> heldVk = new Dictionary<int, ushort>();
        static readonly object sync = new object();

        public static void Seen(int s, ushort b) { live[s] = b; }

        // The button that closed the Guide (or picked "Resume") is still down at this moment;
        // don't let it reach the app as a fresh press.
        public static void Activate()
        {
            lock (sync)
            {
                for (int s = 0; s < 4; s++) { prev[s] = live[s]; ignore[s] = live[s]; }
                held.Clear(); heldVk.Clear();
                accX = accY = accWheel = accHWheel = 0;
                Active = true;
            }
        }

        public static void Deactivate()
        {
            lock (sync)
            {
                Active = false;
                ReleaseAll();
            }
        }
        static readonly Stopwatch clock = Stopwatch.StartNew();

        static void Send(INPUT i) { SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT))); }

        static void Mouse(uint flags, int dx = 0, int dy = 0, int data = 0)
        {
            var i = new INPUT(); i.type = 0;
            i.u.mi.dx = dx; i.u.mi.dy = dy; i.u.mi.dwFlags = flags; i.u.mi.mouseData = (uint)data;
            Send(i);
        }

        static bool Extended(ushort vk) { return (vk >= 0x21 && vk <= 0x28) || vk == 0xA6 || vk == 0x2D || vk == 0x2E; }

        static void Key(ushort vk, bool up)
        {
            var i = new INPUT(); i.type = 1;
            i.u.ki.wVk = vk;
            i.u.ki.dwFlags = (up ? 0x2u : 0u) | (Extended(vk) ? 0x1u : 0u);
            Send(i);
        }

        static void Tap(ushort vk, ushort mod = 0)
        {
            if (mod != 0) Key(mod, false);
            Key(vk, false); Key(vk, true);
            if (mod != 0) Key(mod, true);
        }

        static void ReleaseAll()
        {
            Mouse(0x4); Mouse(0x10); Mouse(0x40);
            foreach (var vk in heldVk.Values) Key(vk, true); // no arrow / page key left logically down
            for (int s = 0; s < 4; s++) prev[s] = 0;
            held.Clear(); heldVk.Clear();
        }

        static double Curve(int v, int dz)
        {
            int a = Math.Abs(v);
            if (a < dz) return 0;
            double n = (a - dz) / (double)(32767 - dz);
            return Math.Sign(v) * n * n;
        }

        public static void Process(int s, XINPUT_GAMEPAD g)
        {
            lock (sync)
            {
                if (!Active) return;
                ProcessLocked(s, g);
            }
        }

        static void ProcessLocked(int s, XINPUT_GAMEPAD g)
        {
            // Pointer + scrolling (called every ~8 ms)
            accX += Curve(g.sThumbLX, 7849) * 24;
            accY -= Curve(g.sThumbLY, 7849) * 24;
            int mx = (int)accX, my = (int)accY;
            accX -= mx; accY -= my;
            if (mx != 0 || my != 0) Mouse(0x1, mx, my);
            accWheel += Curve(g.sThumbRY, 8689) * 30;
            int w = (int)accWheel; accWheel -= w;
            if (w != 0) Mouse(0x800, 0, 0, w);
            accHWheel += Curve(g.sThumbRX, 8689) * 30;
            int hw = (int)accHWheel; accHWheel -= hw;
            if (hw != 0) Mouse(0x1000, 0, 0, hw);

            ignore[s] &= g.wButtons;                       // released buttons stop being ignored
            ushort b = (ushort)(g.wButtons & ~ignore[s]);
            ushort pressed = (ushort)(b & ~prev[s]);
            ushort released = (ushort)(prev[s] & ~b & ~ignore[s]);
            prev[s] = b;

            if ((pressed & 0x1000) != 0) Mouse(0x2);   // A down
            if ((released & 0x1000) != 0) Mouse(0x4); // A up
            if ((pressed & 0x4000) != 0) Mouse(0x8);   // X right down
            if ((released & 0x4000) != 0) Mouse(0x10);
            if ((pressed & 0x40) != 0) Mouse(0x20);    // L3 middle
            if ((released & 0x40) != 0) Mouse(0x40);
            if ((pressed & 0x2000) != 0) Tap(0xA6);    // B: browser back
            if ((pressed & 0x8000) != 0) Tap(0x20);    // Y: space
            if ((pressed & 0x10) != 0) Tap(0x0D);      // Start: enter
            if ((pressed & 0x20) != 0) Tap(0x1B);      // Back: escape
            if ((pressed & 0x80) != 0) Tap(0x46);      // R3: f
            if ((pressed & 0x100) != 0) Tap(0x09, 0x10); // LB: shift+tab
            if ((pressed & 0x200) != 0) Tap(0x09);     // RB: tab

            // D-pad + triggers as repeating keys
            Repeat(s, 0x1, b, 0x26); Repeat(s, 0x2, b, 0x28); Repeat(s, 0x4, b, 0x25); Repeat(s, 0x8, b, 0x27);
            RepeatTrigger(s, 100, g.bLeftTrigger > 110, 0x21);
            RepeatTrigger(s, 101, g.bRightTrigger > 110, 0x22);
        }

        static void Repeat(int s, int bit, ushort b, ushort vk) { RepeatTrigger(s, bit, (b & bit) != 0, vk); }

        static void RepeatTrigger(int s, int id, bool down, ushort vk)
        {
            int key = s * 1000 + id;
            long now = clock.ElapsedMilliseconds;
            long since;
            bool was = held.TryGetValue(key, out since);
            if (down && !was) { held[key] = now; heldVk[key] = vk; Key(vk, false); }
            else if (down && was && now - since > 420) { held[key] = now - 350; Key(vk, false); } // ~70 ms repeat
            else if (!down && was) { held.Remove(key); heldVk.Remove(key); Key(vk, true); }
        }
    }

    // ------------------------------------------------------------------ Core Audio
    enum EDataFlow { eRender = 0, eCapture = 1, eAll = 2 }
    enum ERole { eConsole = 0, eMultimedia = 1, eCommunications = 2 }

    [StructLayout(LayoutKind.Sequential)]
    struct PROPERTYKEY { public Guid fmtid; public int pid; }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct PROPVARIANT
    {
        [FieldOffset(0)] public short vt;
        [FieldOffset(8)] public IntPtr pointerValue;
    }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
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
        [PreserveSig] int SetValue(ref PROPERTYKEY key, ref PROPVARIANT value);
        [PreserveSig] int Commit();
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out int count);
        [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid ctx);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid ctx);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(int ch, float level, ref Guid ctx);
        [PreserveSig] int SetChannelVolumeLevelScalar(int ch, float level, ref Guid ctx);
        [PreserveSig] int GetChannelVolumeLevel(int ch, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(int ch, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid ctx);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    [ComImport, Guid("F8679F50-850A-41cf-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr fmt);
        [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int def, IntPtr fmt);
        [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
        [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr ep, IntPtr mix);
        [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int def, IntPtr a, IntPtr b);
        [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr a);
        [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
        [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr key, IntPtr val);
        [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr key, IntPtr val);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, ERole role);
        [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
    }

    static class Audio
    {
        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT pv);

        static readonly Guid CLSID_MMDeviceEnumerator = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
        static readonly Guid CLSID_PolicyConfig = new Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9");
        static readonly Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        static PROPERTYKEY PKEY_FriendlyName = MakeKey("a45c254e-df1c-4efd-8020-67d146a850e0", 14);

        static PROPERTYKEY MakeKey(string g, int pid) { var k = new PROPERTYKEY(); k.fmtid = new Guid(g); k.pid = pid; return k; }

        static IMMDeviceEnumerator Enumerator()
        {
            return (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_MMDeviceEnumerator));
        }

        static IAudioEndpointVolume DefaultVolume()
        {
            IMMDevice dev;
            Check(Enumerator().GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out dev));
            Guid iid = IID_IAudioEndpointVolume;
            object o;
            Check(dev.Activate(ref iid, 23 /*CLSCTX_ALL*/, IntPtr.Zero, out o));
            return (IAudioEndpointVolume)o;
        }

        static void Check(int hr) { if (hr != 0) Marshal.ThrowExceptionForHR(hr); }

        public static string GetVolumeJson()
        {
            var v = DefaultVolume();
            float level; bool mute;
            Check(v.GetMasterVolumeLevelScalar(out level));
            Check(v.GetMute(out mute));
            return "{\"volume\":" + Json.Num(level) + ",\"muted\":" + Json.Bool(mute) + "}";
        }

        public static void SetVolume(float level)
        {
            Guid ctx = Guid.Empty;
            Check(DefaultVolume().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, level)), ref ctx));
        }

        public static void SetMute(bool mute)
        {
            Guid ctx = Guid.Empty;
            Check(DefaultVolume().SetMute(mute, ref ctx));
        }

        public static string ListJson()
        {
            var en = Enumerator();
            string defId = null;
            IMMDevice def;
            if (en.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out def) == 0) def.GetId(out defId);
            IMMDeviceCollection col;
            Check(en.EnumAudioEndpoints(EDataFlow.eRender, 1 /*ACTIVE*/, out col));
            int count; col.GetCount(out count);
            var sb = new StringBuilder("[");
            for (int i = 0; i < count; i++)
            {
                IMMDevice d;
                if (col.Item(i, out d) != 0) continue;
                string id; d.GetId(out id);
                string name = id;
                IPropertyStore store;
                if (d.OpenPropertyStore(0, out store) == 0)
                {
                    PROPVARIANT pv;
                    var key = PKEY_FriendlyName;
                    if (store.GetValue(ref key, out pv) == 0)
                    {
                        if (pv.vt == 31) name = Marshal.PtrToStringUni(pv.pointerValue);
                        PropVariantClear(ref pv);
                    }
                }
                if (sb.Length > 1) sb.Append(',');
                sb.Append("{\"id\":" + Json.Str(id) + ",\"name\":" + Json.Str(name) + ",\"default\":" + Json.Bool(id == defId) + "}");
            }
            sb.Append(']');
            return sb.ToString();
        }

        public static void SetDefault(string id)
        {
            var pc = (IPolicyConfig)Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_PolicyConfig));
            Check(pc.SetDefaultEndpoint(id, ERole.eConsole));
            Check(pc.SetDefaultEndpoint(id, ERole.eMultimedia));
            pc.SetDefaultEndpoint(id, ERole.eCommunications);
        }
    }

    // ------------------------------------------------------------------ Processes
    static class Procs
    {
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);

        public static string PathOf(int pid)
        {
            IntPtr h = OpenProcess(0x1000 /*QUERY_LIMITED_INFORMATION*/, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var sb = new StringBuilder(1024);
                int size = sb.Capacity;
                if (QueryFullProcessImageName(h, 0, sb, ref size)) return sb.ToString();
                return null;
            }
            finally { CloseHandle(h); }
        }

        // pid -> image path for processes under any of dirs or named like any of exes.
        public static Dictionary<int, string> MatchPids(string dirsArg, string exesArg)
        {
            var dirs = new List<string>();
            foreach (string d in dirsArg.Split('|'))
            {
                if (d.Trim().Length == 0) continue;
                string n = d.Trim().Replace('/', '\\').ToLowerInvariant();
                if (!n.EndsWith("\\")) n += "\\";
                dirs.Add(n);
            }
            var exes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string e in exesArg.Split('|')) if (e.Trim().Length > 0) exes.Add(e.Trim());
            var map = new Dictionary<int, string>();
            int self = Process.GetCurrentProcess().Id;
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    if (p.Id == self || p.Id <= 4) continue;
                    string path = PathOf(p.Id);
                    if (path == null) continue;
                    string lower = path.ToLowerInvariant();
                    bool hit = exes.Contains(Path.GetFileName(path));
                    if (!hit) foreach (string d in dirs) if (lower.StartsWith(d)) { hit = true; break; }
                    if (hit) map[p.Id] = path;
                }
                catch { }
                finally { p.Dispose(); }
            }
            return map;
        }

        // dirs: '|' separated install directories; exes: '|' separated executable file names.
        public static string FindJson(string dirsArg, string exesArg)
        {
            var dirs = new List<string>();
            foreach (string d in dirsArg.Split('|'))
            {
                if (d.Trim().Length == 0) continue;
                string n = d.Trim().Replace('/', '\\').ToLowerInvariant();
                if (!n.EndsWith("\\")) n += "\\";
                dirs.Add(n);
            }
            var exes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string e in exesArg.Split('|')) if (e.Trim().Length > 0) exes.Add(e.Trim());

            var sb = new StringBuilder("[");
            int self = Process.GetCurrentProcess().Id;
            foreach (var p in Process.GetProcesses())
            {
                try
                {
                    if (p.Id == self || p.Id <= 4) continue;
                    string path = PathOf(p.Id);
                    if (path == null) continue;
                    string lower = path.ToLowerInvariant();
                    bool hit = exes.Contains(Path.GetFileName(path));
                    if (!hit) foreach (string d in dirs) if (lower.StartsWith(d)) { hit = true; break; }
                    if (!hit) continue;
                    if (sb.Length > 1) sb.Append(',');
                    sb.Append("{\"pid\":" + p.Id + ",\"path\":" + Json.Str(path) + "}");
                }
                catch { }
                finally { p.Dispose(); }
            }
            sb.Append(']');
            return sb.ToString();
        }
    }

    // ------------------------------------------------------------------ Windows
    static class Win
    {
        delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int idx);
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint cmd);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT r);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("powrprof.dll", SetLastError = true)] public static extern bool SetSuspendState(bool hibernate, bool force, bool disableWake);

        [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }

        public static bool ForceForeground(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            if (IsIconic(hwnd)) ShowWindow(hwnd, 9 /*SW_RESTORE*/);
            if (GetForegroundWindow() == hwnd) return true;

            uint dummy;
            uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out dummy);
            uint me = GetCurrentThreadId();
            bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
            if (attached) AttachThreadInput(me, fgThread, false);
            if (GetForegroundWindow() == hwnd) return true;

            // Fallback: a synthetic ALT tap grants this process the foreground lock.
            keybd_event(0x12, 0, 0x1, UIntPtr.Zero);
            keybd_event(0x12, 0, 0x1 | 0x2, UIntPtr.Zero);
            SetForegroundWindow(hwnd);
            return GetForegroundWindow() == hwnd;
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder sb, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder sb, int max);
        [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);

        // Visible, unowned, non-tool top-level windows of the given processes.
        public static string FindWindowsJson(Dictionary<int, string> pids)
        {
            var sb = new StringBuilder("[");
            EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                string path;
                if (!pids.TryGetValue((int)pid, out path) || !IsWindowVisible(h)) return true;
                if (GetWindow(h, 4 /*GW_OWNER*/) != IntPtr.Zero) return true;
                if ((GetWindowLong(h, -20) & 0x80) != 0) return true; // WS_EX_TOOLWINDOW
                RECT r;
                GetWindowRect(h, out r);
                var title = new StringBuilder(256);
                GetWindowText(h, title, 256);
                var cls = new StringBuilder(128);
                GetClassName(h, cls, 128);
                if (sb.Length > 1) sb.Append(',');
                sb.Append("{\"hwnd\":\"" + h.ToInt64() + "\",\"pid\":" + pid + ",\"exe\":" + Json.Str(Path.GetFileName(path)) +
                    ",\"title\":" + Json.Str(title.ToString()) + ",\"cls\":" + Json.Str(cls.ToString()) +
                    ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + ",\"iconic\":" + Json.Bool(IsIconic(h)) + "}");
                return true;
            }, IntPtr.Zero);
            sb.Append(']');
            return sb.ToString();
        }

        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
        // A game's window still exists and is shown (minimized still counts as alive).
        public static bool Alive(IntPtr h) { return h != IntPtr.Zero && IsWindow(h) && IsWindowVisible(h); }

        public static bool HideWindow(IntPtr h) { return h != IntPtr.Zero && ShowWindow(h, 0 /*SW_HIDE*/); }

        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        // Bottom of the z-order: covers the desktop but stays behind every other window.
        public static bool SendToBottom(IntPtr h) { return SetWindowPos(h, new IntPtr(1) /*HWND_BOTTOM*/, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010 /*NOSIZE|NOMOVE|NOACTIVATE*/); }

        // Politely asks every top-level window of the processes to close (WM_CLOSE).
        public static int ClosePids(string pidsArg)
        {
            var pids = new HashSet<uint>();
            foreach (string s in pidsArg.Split('|')) { uint v; if (uint.TryParse(s, out v)) pids.Add(v); }
            int n = 0;
            EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                if (pids.Contains(pid) && IsWindowVisible(h)) { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); n++; }
                return true;
            }, IntPtr.Zero);
            return n;
        }

        public static bool FocusPids(string pidsArg)
        {
            var pids = new HashSet<uint>();
            foreach (string s in pidsArg.Split('|')) { uint v; if (uint.TryParse(s, out v)) pids.Add(v); }
            IntPtr best = IntPtr.Zero;
            long bestArea = 0;
            EnumWindows(delegate (IntPtr h, IntPtr l)
            {
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                if (!pids.Contains(pid) || !IsWindowVisible(h)) return true;
                if (GetWindow(h, 4 /*GW_OWNER*/) != IntPtr.Zero) return true;
                int ex = GetWindowLong(h, -20);
                if ((ex & 0x80) != 0) return true; // WS_EX_TOOLWINDOW
                RECT r;
                GetWindowRect(h, out r);
                long area = (long)(r.R - r.L) * (r.B - r.T);
                if (area > bestArea) { bestArea = area; best = h; }
                return true;
            }, IntPtr.Zero);
            return ForceForeground(best);
        }
    }
}
