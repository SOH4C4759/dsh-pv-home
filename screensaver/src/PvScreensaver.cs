// dsh-pv-home screen saver — plays the PV fullscreen.
//
// Why a screen saver and not "the lock screen": Windows' lock screen accepts a
// still image (or a slideshow of images) and nothing else. The one surface the OS
// will hand to a third-party program and let it draw video on is the screen
// saver, which is what this is. With ScreenSaverIsSecure=1 it also demands the
// logon screen on resume, so the practical effect is "you come back and the PV
// was playing".
//
// A .scr is an ordinary Win32 executable called with one of three arguments:
//   /s          show it (the real thing)
//   /c[:hwnd]   configure — this saver has nothing to configure, so it explains
//               where the settings live instead
//   /p <hwnd>   preview inside the little monitor in the Screen Saver dialog
// plus one argument of our own:
//   /selftest <file>   open the film through Media Foundation, write the result
//               to <file>, and exit WITHOUT showing anything. This exists so the
//               build can prove the film actually decodes on this machine — a
//               claim no offline test can make, and one a screen saver that only
//               ever runs when nobody is watching would otherwise never prove.
//
// Comments are ASCII on purpose: csc reads a BOM-less file with the system code
// page, and that is a class of bug worth not having.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using Forms = System.Windows.Forms;

namespace PvScreensaver
{
    /// <summary>Everything the saver needs to know, read from an ini next to it.</summary>
    internal sealed class SaverConfig
    {
        public string VideoPath = "";

        /// <summary>
        /// Silent by DEFAULT, and that default is a fix rather than a taste: a
        /// screen saver fires when nobody is in the room, and the first version
        /// of this one started singing. The ini beside it sets the real value.
        /// </summary>
        public bool Muted = true;

        public double Volume = 1.0;

        /// <summary>
        /// Which monitors show the film: `all` or `primary`.
        ///
        /// Independent of muting, but it exists for the same reason. Each window
        /// decodes the file itself, so on a multi-monitor desk `all` is N decoders
        /// and — before the audio-owner rule below — N copies of the soundtrack
        /// playing a few milliseconds apart, which is heard as a doubled, hollow
        /// track rather than as an echo.
        /// </summary>
        public string Screens = "all";

        /// <summary>
        /// Lock the workstation when the saver is dismissed.
        ///
        /// Only meaningful for a saver started BY HAND (the lock button): when
        /// Windows starts it on idle, `ScreenSaverIsSecure=1` already puts the
        /// logon screen in front of the desktop after any input, so this flag
        /// would be redundant there. Set by the `/lock` argument, never by the
        /// ini, so the idle path and the button path can differ.
        /// </summary>
        public bool LockOnExit = false;

        public bool ShowClock = false;

        /// <summary>
        /// Read `key=value` pairs from the ini beside the executable, falling back
        /// to `film.mp4` beside it. A missing or unreadable ini is not an error:
        /// the saver then plays whatever sits next to it, or says so on screen.
        /// </summary>
        public static SaverConfig Load(string exePath)
        {
            var config = new SaverConfig();
            string directory = Path.GetDirectoryName(exePath) ?? ".";
            string fallback = Path.Combine(directory, "film.mp4");
            config.VideoPath = File.Exists(fallback) ? fallback : "";

            string ini = Path.Combine(directory, "pv-screensaver.ini");
            if (!File.Exists(ini)) return config;

            try
            {
                foreach (string raw in File.ReadAllLines(ini))
                {
                    string line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith("#") || line.StartsWith(";")) continue;
                    int split = line.IndexOf('=');
                    if (split <= 0) continue;
                    string key = line.Substring(0, split).Trim().ToLowerInvariant();
                    string value = line.Substring(split + 1).Trim().Trim('"');
                    switch (key)
                    {
                        case "video":
                            // A relative path is relative to the ini, not to the cwd
                            // (the Screen Saver dialog runs the saver from System32).
                            config.VideoPath = Path.IsPathRooted(value) ? value : Path.Combine(directory, value);
                            break;
                        case "muted":
                            config.Muted = value == "1" || value.Equals("true", StringComparison.OrdinalIgnoreCase);
                            break;
                        case "volume":
                            double parsed;
                            if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out parsed))
                            {
                                config.Volume = Math.Max(0.0, Math.Min(1.0, parsed));
                            }
                            break;
                        case "clock":
                            config.ShowClock = value == "1" || value.Equals("true", StringComparison.OrdinalIgnoreCase);
                            break;
                        case "screens":
                            config.Screens = value.Equals("primary", StringComparison.OrdinalIgnoreCase) ? "primary" : "all";
                            break;
                    }
                }
            }
            catch (Exception)
            {
                // An unreadable ini keeps the defaults rather than failing to start.
            }
            return config;
        }
    }

    /// <summary>One fullscreen window on one monitor, looping the film.</summary>
    internal sealed class FilmWindow : Window
    {
        private readonly MediaElement _player;
        private readonly SaverConfig _config;
        private readonly bool _ownsAudio;
        private readonly DateTime _shownAt = DateTime.UtcNow;

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        // Windows sends a synthetic mouse move as the saver appears; without this
        // grace period the saver would close itself the instant it opened.
        private static readonly TimeSpan InputGrace = TimeSpan.FromMilliseconds(700);

        /// <summary>Whether this window is the one allowed to make noise.</summary>
        internal bool OwnsAudio { get { return _ownsAudio; } }

        /// <summary>Playback position, or null while the media has not opened.</summary>
        internal TimeSpan? Position
        {
            get
            {
                try
                {
                    return _player.NaturalDuration.HasTimeSpan ? (TimeSpan?)_player.Position : null;
                }
                catch (Exception)
                {
                    return null;
                }
            }
            set
            {
                try
                {
                    if (_player.NaturalDuration.HasTimeSpan && value.HasValue) _player.Position = value.Value;
                }
                catch (Exception)
                {
                    // A seek on a media that is not ready is not a failure worth acting on.
                }
            }
        }

        /// <param name="config">Saver settings.</param>
        /// <param name="screen">Monitor this window covers.</param>
        /// <param name="scale">Primary-monitor DPI scale, for device-to-DIP bounds.</param>
        /// <param name="ownsAudio">
        /// True for exactly ONE window per run. Every other window stays muted even
        /// when sound is enabled: each window decodes the film itself, so unmuting
        /// them all plays the same soundtrack several times over, a few
        /// milliseconds apart — which the ear hears as one doubled, hollow track.
        /// </param>
        public FilmWindow(SaverConfig config, Forms.Screen screen, double scale, bool ownsAudio)
        {
            _config = config;
            _ownsAudio = ownsAudio;

            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            AllowsTransparency = false;
            ShowInTaskbar = false;
            Topmost = true;
            Background = Brushes.Black;
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = screen.Bounds.Left / scale;
            Top = screen.Bounds.Top / scale;

            _player = new MediaElement
            {
                LoadedBehavior = MediaState.Manual,
                UnloadedBehavior = MediaState.Manual,
                Stretch = Stretch.UniformToFill,
                // Silence is decided here, once, and never undone later: the
                // audio-owner rule is what keeps a multi-monitor run to a single
                // soundtrack.
                IsMuted = config.Muted || !ownsAudio,
                Volume = config.Muted || !ownsAudio ? 0.0 : config.Volume,
                ScrubbingEnabled = false,
            };
            Content = _player;

            if (config.VideoPath.Length > 0 && File.Exists(config.VideoPath))
            {
                _player.Source = new Uri(config.VideoPath, UriKind.Absolute);
            }

            // Looping is a handler rather than a property: MediaElement has no
            // loop, and `Position` must be reset before `Play` or the second pass
            // starts from the end and stops on the first frame.
            _player.MediaEnded += delegate
            {
                _player.Position = TimeSpan.Zero;
                _player.Play();
            };
            // MediaElement reports failures with a ROUTED event args type; the
            // MediaPlayer used by /selftest reports the plain one. Same exception
            // inside, different delegate signature.
            _player.MediaFailed += delegate(object sender, ExceptionRoutedEventArgs args)
            {
                // Nothing to play. Leave the black screen and stay out of the way;
                // the user's input still dismisses it.
                Console.WriteLine("pv screensaver: media failed: " + args.ErrorException.Message);
            };
            _player.MediaOpened += delegate
            {
                _player.IsMuted = _config.Muted || !_ownsAudio;
                if (_player.IsMuted) _player.Volume = 0.0;
                _player.Play();
            };

            Loaded += delegate
            {
                WindowState = WindowState.Maximized;
                Cursor = Cursors.None;
                // A saver started by ANOTHER process does not automatically become
                // the foreground window, so without this the first key press goes
                // to whatever is behind it and does not dismiss anything. Mouse
                // movement would still work (mouse messages follow the pointer),
                // which is exactly the kind of half-working that is worth not
                // shipping.
                try
                {
                    SetForegroundWindow(new WindowInteropHelper(this).Handle);
                }
                catch (Exception)
                {
                    // Losing the foreground race only costs the first key press.
                }
                _player.Play();
            };
        }

        private bool PastGrace()
        {
            return DateTime.UtcNow - _shownAt > InputGrace;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (PastGrace()) Close();
        }

        protected override void OnMouseDown(MouseButtonEventArgs e)
        {
            base.OnMouseDown(e);
            Close();
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            base.OnKeyDown(e);
            Close();
        }
    }

    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern IntPtr SetParent(IntPtr child, IntPtr parent);

        [DllImport("user32.dll")]
        private static extern bool LockWorkStation();

        [DllImport("user32.dll")]
        private static extern bool GetClientRect(IntPtr hWnd, out Rect rect);

        [DllImport("user32.dll")]
        private static extern bool MoveWindow(IntPtr hWnd, int x, int y, int width, int height, bool repaint);

        [StructLayout(LayoutKind.Sequential)]
        private struct Rect { public int Left, Top, Right, Bottom; }

        [STAThread]
        private static int Main(string[] args)
        {
            string exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
            SaverConfig config = SaverConfig.Load(exePath);

            string mode = args.Length > 0 ? args[0].Trim().ToLowerInvariant() : "/s";

            // `/lock` rides along with `/s` when the saver was started by hand:
            // exiting must leave the user at the logon screen, or "lock" would
            // have meant "show a film and then hand the desktop back".
            foreach (string argument in args)
            {
                if (argument.Trim().ToLowerInvariant() == "/lock") config.LockOnExit = true;
            }

            if (mode.StartsWith("/selftest"))
            {
                string output = args.Length > 1 ? args[1] : Path.Combine(Path.GetTempPath(), "pv-screensaver-selftest.txt");
                return SelfTest(config, output);
            }

            // /geom writes the per-monitor geometry the saver would use. Showing
            // windows is the only part of /s a test cannot safely do (it would
            // take over the screen), but the arithmetic that decides where those
            // windows land is checkable on its own.
            if (mode.StartsWith("/geom"))
            {
                string output = args.Length > 1 ? args[1] : Path.Combine(Path.GetTempPath(), "pv-screensaver-geom.txt");
                var report = new List<string>();
                double factor = PrimaryScale();
                report.Add("windows=" + Forms.Screen.AllScreens.Length);
                report.Add("scale=" + factor.ToString("0.###", CultureInfo.InvariantCulture));
                report.Add("screens=" + config.Screens);
                report.Add("muted=" + config.Muted);
                report.Add("lockOnExit=" + config.LockOnExit);
                // The rule that fixes the doubled soundtrack: however many windows
                // open, exactly one of them is unmuted.
                int audioWindows = 0;
                foreach (Forms.Screen screen in Forms.Screen.AllScreens)
                {
                    if (config.Screens == "primary" && !screen.Primary) continue;
                    if (!config.Muted && screen.Primary) audioWindows++;
                }
                report.Add("audioWindows=" + audioWindows);
                foreach (Forms.Screen screen in Forms.Screen.AllScreens)
                {
                    if (config.Screens == "primary" && !screen.Primary) continue;
                    report.Add(string.Format(
                        CultureInfo.InvariantCulture,
                        "screen primary={0} device={1}x{2} dipLeft={3:0.##} dipTop={4:0.##} video={5}",
                        screen.Primary,
                        screen.Bounds.Width,
                        screen.Bounds.Height,
                        screen.Bounds.Left / factor,
                        screen.Bounds.Top / factor,
                        config.VideoPath.Length > 0 ? "set" : "missing"));
                }
                File.WriteAllLines(output, report);
                return 0;
            }

            if (mode.StartsWith("/c"))
            {
                MessageBox.Show(
                    "This screen saver has nothing to configure of its own.\n\n"
                    + "It plays the film named in pv-screensaver.ini beside the .scr file:\n"
                    + (config.VideoPath.Length > 0 ? config.VideoPath : "(none set)") + "\n\n"
                    + "Change the file by editing that ini; change how long Windows waits, and "
                    + "whether it asks for your password on resume, in Windows Settings > "
                    + "Personalization > Lock screen > Screen saver.",
                    "DSH PV screen saver",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information);
                return 0;
            }

            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            double scale = PrimaryScale();

            if (mode.StartsWith("/p"))
            {
                // Preview: a child window of the little monitor in the dialog. If the
                // handle is unusable the saver just exits — the dialog shows an empty
                // monitor, which is what a preview that cannot work should look like.
                IntPtr parent = IntPtr.Zero;
                if (args.Length > 1)
                {
                    long parsed;
                    if (long.TryParse(args[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
                    {
                        parent = new IntPtr(parsed);
                    }
                }
                if (parent == IntPtr.Zero) return 1;

                Rect bounds;
                if (!GetClientRect(parent, out bounds)) return 1;
                int width = bounds.Right - bounds.Left;
                int height = bounds.Bottom - bounds.Top;
                if (width <= 0 || height <= 0) return 1;

                var preview = new Window
                {
                    WindowStyle = WindowStyle.None,
                    ResizeMode = ResizeMode.NoResize,
                    ShowInTaskbar = false,
                    Background = Brushes.Black,
                    Width = Math.Max(1, width),
                    Height = Math.Max(1, height),
                };
                var element = new MediaElement
                {
                    LoadedBehavior = MediaState.Manual,
                    UnloadedBehavior = MediaState.Manual,
                    Stretch = Stretch.Uniform,
                    IsMuted = true,
                    Source = config.VideoPath.Length > 0 && File.Exists(config.VideoPath)
                        ? new Uri(config.VideoPath, UriKind.Absolute)
                        : null,
                };
                preview.Content = element;
                preview.Show();
                IntPtr handle = new WindowInteropHelper(preview).Handle;
                SetParent(handle, parent);
                MoveWindow(handle, 0, 0, width, height, true);
                element.Play();
                app.Run();
                return 0;
            }

            // /s — the real thing: one window per chosen monitor, all looping.
            //
            // Exactly ONE of them is allowed to make noise (see the audio-owner
            // rule in FilmWindow). The others stay muted and are periodically
            // nudged back into step with it, because each window runs its own
            // decoder and they drift apart by tens of milliseconds a minute.
            var targets = new List<Forms.Screen>();
            foreach (Forms.Screen screen in Forms.Screen.AllScreens)
            {
                if (config.Screens == "primary" && !screen.Primary) continue;
                targets.Add(screen);
            }
            if (targets.Count == 0) targets.Add(Forms.Screen.PrimaryScreen);

            FilmWindow audioOwner = null;
            var windows = new List<FilmWindow>();
            foreach (Forms.Screen screen in targets)
            {
                bool ownsAudio = audioOwner == null && (screen.Primary || targets.Count == 1);
                var window = new FilmWindow(config, screen, scale, ownsAudio);
                if (ownsAudio) audioOwner = window;
                window.Closed += delegate
                {
                    // Any input on any monitor ends the whole saver, not just that
                    // monitor's copy of the film.
                    window.Dispatcher.InvokeShutdown();
                };
                windows.Add(window);
                window.Show();
            }

            if (audioOwner == null && windows.Count > 0) audioOwner = windows[0];

            if (audioOwner != null && windows.Count > 1)
            {
                var align = new DispatcherTimer { Interval = TimeSpan.FromSeconds(20) };
                align.Tick += delegate
                {
                    TimeSpan? reference = audioOwner.Position;
                    if (!reference.HasValue) return;
                    foreach (FilmWindow follower in windows)
                    {
                        if (ReferenceEquals(follower, audioOwner)) continue;
                        TimeSpan? at = follower.Position;
                        if (!at.HasValue) continue;
                        // 400 ms is the threshold, not the tolerance: seeking a
                        // MediaElement costs a visible hitch, so a gap smaller than
                        // this is better left alone than corrected.
                        if (Math.Abs((at.Value - reference.Value).TotalMilliseconds) > 400)
                        {
                            follower.Position = reference;
                        }
                    }
                };
                align.Start();
            }

            if (windows.Count == 0)
            {
                // Nothing to show. If the caller asked for a lock, the lock is
                // still owed: a button that promises a lock and delivers a black
                // flash would be worse than one that just locks.
                if (config.LockOnExit) LockWorkStation();
                return 1;
            }
            app.Run();

            // Reached on every exit path of /s — dismissal by input, a media
            // failure that closed the last window, or an explicit shutdown. The
            // lock is what turns "a film played" into "the screen is locked".
            if (config.LockOnExit) LockWorkStation();
            return 0;
        }

        /// <summary>
        /// Primary-monitor DPI scale, used to turn device-pixel screen bounds into
        /// the DIP coordinates WPF positions windows with.
        /// </summary>
        private static double PrimaryScale()
        {
            try
            {
                using (var graphics = System.Drawing.Graphics.FromHwnd(IntPtr.Zero))
                {
                    return graphics.DpiX / 96.0;
                }
            }
            catch (Exception)
            {
                return 1.0;
            }
        }

        /// <summary>
        /// Open the film with Media Foundation, report, exit. No window is ever
        /// shown, so this is safe to run from a test.
        /// </summary>
        private static int SelfTest(SaverConfig config, string output)
        {
            var lines = new List<string>();
            lines.Add("video=" + config.VideoPath);
            if (config.VideoPath.Length == 0 || !File.Exists(config.VideoPath))
            {
                lines.Add("result=missing");
                File.WriteAllLines(output, lines);
                return 1;
            }

            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            var player = new MediaPlayer();
            // MediaPlayer's own default is 0.5, so reporting it without applying
            // the config would report the library's default rather than this
            // saver's behaviour.
            player.Volume = config.Muted ? 0.0 : config.Volume;
            string result = "timeout";

            player.MediaOpened += delegate
            {
                result = "ok"
                    + " width=" + player.NaturalVideoWidth
                    + " height=" + player.NaturalVideoHeight
                    + " seconds=" + player.NaturalDuration.TimeSpan.TotalSeconds.ToString("0.###", CultureInfo.InvariantCulture)
                    + " audio=" + player.HasAudio
                    + " volume=" + player.Volume.ToString("0.##", CultureInfo.InvariantCulture);
                app.Shutdown();
            };
            player.MediaFailed += delegate(object sender, ExceptionEventArgs args)
            {
                result = "failed " + args.ErrorException.GetType().Name + ": " + args.ErrorException.Message;
                app.Shutdown();
            };

            var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
            timer.Tick += delegate
            {
                timer.Stop();
                app.Shutdown();
            };
            timer.Start();

            player.Open(new Uri(config.VideoPath, UriKind.Absolute));
            app.Run();

            lines.Add("result=" + result);
            lines.Add("muted=" + config.Muted);
            File.WriteAllLines(output, lines);
            return result.StartsWith("ok") ? 0 : 2;
        }
    }
}
