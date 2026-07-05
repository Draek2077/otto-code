# Whole-tree teardown for the Windows dev scripts.
#
# Attaches the current PowerShell process to a Windows Job Object configured
# with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. Every process spawned after the
# attach inherits job membership — concurrently, Metro, Electron, the dev
# daemon Electron spawns with detached:true, and any preview dev servers the
# daemon spawns — and the kernel terminates all surviving members the moment
# this PowerShell process exits, whether via Ctrl-C, normal completion,
# closing the terminal, or a hard kill.
#
# Why a job object and not signal propagation or a PPID walk:
# - Ctrl-C's CTRL_C_EVENT only reaches processes attached to this console.
#   Electron's helper processes and the daemon / preview servers (spawned
#   with DETACHED_PROCESS / CREATE_NO_WINDOW) never see it.
# - A parent-PID walk breaks as soon as an intermediate process (npx, cmd,
#   concurrently) dies first — the orphans' ancestry is unreachable.
# - taskkill /T /F has been observed failing with "Access is denied" on
#   exactly these orphans. Job termination is kernel-level (the same
#   primitive Stop-Process uses) and does not have that failure mode.
#
# Kill-on-close alone is NOT enough. On Ctrl-C the tree deadlocks instead of
# exiting (observed live): concurrently catches SIGINT and waits for its
# children to die, but its non-forced taskkill can't kill Electron's helper
# processes; PowerShell in turn waits for concurrently before it can stop the
# script; and the survivors only die when PowerShell exits and closes the job
# handle. Circular wait — nothing ever exits. So AttachSelf also registers a
# native console Ctrl-C handler (SetConsoleCtrlHandler): the OS calls it on a
# fresh thread even while PowerShell's pipeline thread is blocked in the
# native call. It gives the tree a grace period to unwind on its own, then
# calls TerminateJobObject — killing every job member including this
# PowerShell, which is the desired outcome.
#
# detached:true / unref() children do NOT escape the job: those flags only
# detach from the console and process group. Escaping would require
# CREATE_BREAKAWAY_FROM_JOB, which nothing in this tree requests and which
# this job does not permit.
#
# Escape hatch: set OTTO_DEV_KEEP_TREE=1 to skip the attach and leave
# children running after the script exits (pre-fix behavior).

function Enable-OttoDevTreeTeardown {
    if ($env:OTTO_DEV_KEEP_TREE -eq "1") {
        Write-Host "  (OTTO_DEV_KEEP_TREE=1 - child processes will outlive this script)"
        return
    }

    if (-not ([System.Management.Automation.PSTypeName]"OttoDevJob").Type) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class OttoDevJob
{
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    private const uint CTRL_C_EVENT = 0;
    private const uint CTRL_BREAK_EVENT = 1;
    // Long enough for Metro/Electron to unwind gracefully after Ctrl-C,
    // short enough that a second Ctrl-C out of impatience isn't needed.
    private const int CTRL_C_GRACE_MS = 5000;

    public delegate bool ConsoleCtrlHandler(uint ctrlType);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr hJob,
        int jobObjectInfoClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION lpJobObjectInfo,
        int cbJobObjectInfoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr hJob, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetConsoleCtrlHandler(ConsoleCtrlHandler handler, bool add);

    // Held (never closed) for the life of this process. The kernel closes it
    // on process exit, which is exactly what fires kill-on-close for the
    // remaining job members. Do not add a Dispose path.
    private static IntPtr jobHandle = IntPtr.Zero;

    // Strong reference so the marshaled delegate outlives GC cycles; without
    // this the OS would call into freed memory on Ctrl-C.
    private static ConsoleCtrlHandler ctrlHandlerRef;

    private static bool OnConsoleCtrl(uint ctrlType)
    {
        if (ctrlType == CTRL_C_EVENT || ctrlType == CTRL_BREAK_EVENT)
        {
            // The OS invokes this on its own thread, so it runs even while
            // PowerShell's pipeline thread is blocked waiting on a native
            // command. Give the tree a grace period to exit on its own, then
            // hard-terminate every job member (including this process). If
            // the tree exits within the grace period this process dies first
            // and the timer thread simply never fires.
            System.Threading.Thread killer = new System.Threading.Thread(delegate ()
            {
                System.Threading.Thread.Sleep(CTRL_C_GRACE_MS);
                IntPtr job = jobHandle;
                if (job != IntPtr.Zero)
                {
                    TerminateJobObject(job, 130);
                }
            });
            killer.IsBackground = true;
            killer.Start();
        }
        return false; // let PowerShell's own Ctrl-C handling proceed too
    }

    public static string AttachSelf()
    {
        if (jobHandle != IntPtr.Zero)
        {
            return null;
        }
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            return "CreateJobObject failed (error " + Marshal.GetLastWin32Error() + ")";
        }
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref info, size))
        {
            return "SetInformationJobObject failed (error " + Marshal.GetLastWin32Error() + ")";
        }
        if (!AssignProcessToJobObject(job, GetCurrentProcess()))
        {
            return "AssignProcessToJobObject failed (error " + Marshal.GetLastWin32Error() + ")";
        }
        jobHandle = job;
        ctrlHandlerRef = new ConsoleCtrlHandler(OnConsoleCtrl);
        if (!SetConsoleCtrlHandler(ctrlHandlerRef, true))
        {
            return "SetConsoleCtrlHandler failed (error " + Marshal.GetLastWin32Error() + ")"
                + " - job attached, but Ctrl-C teardown will rely on this process exiting";
        }
        return null;
    }
}
"@
    }

    $attachError = [OttoDevJob]::AttachSelf()
    if (-not $attachError) {
        Write-Host "  (dev tree tied to this window: exiting kills all child processes)"
    }
    if ($attachError) {
        Write-Warning ("Could not attach dev tree to a kill-on-close job object: $attachError. " +
            "Child processes (Electron, daemon, preview servers) may survive Ctrl-C " +
            "and need manual cleanup (Stop-Process).")
    }
}
