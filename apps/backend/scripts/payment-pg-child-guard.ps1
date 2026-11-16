param(
    [Parameter(Mandatory=$true)][string]$Payload,
    [Parameter(Mandatory=$true)][int]$OwnerPid,
    [Parameter(Mandatory=$true)][int]$TimeoutMs
)
# This helper accepts executable/arguments only, never connection credentials.
# A private Windows Job owns the suspended target and every descendant. No
# process-name matching, taskkill, global process enumeration or privilege change.
$ErrorActionPreference = 'Stop'
try {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Diagnostics;
public static class PaymentPgJob {
    [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct Limits {
        public long processTime, jobTime; public uint flags;
        public UIntPtr minWorking, maxWorking; public uint activeLimit;
        public UIntPtr affinity; public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct Extended {
        public Limits basic; public IO io; public UIntPtr processMem,jobMem,peakProcess,peakJob;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long a,b,c,d; public uint faults,total,active,terminated;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
        public uint size; public string reserved,desktop,title;
        public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
        public ushort show,reservedSize; public IntPtr reserved2,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attr,string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Extended info,uint length);
    [DllImport("kernel32.dll")] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting info,uint length,IntPtr returned);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(
        string app,StringBuilder command,IntPtr processAttr,IntPtr threadAttr,bool inherit,uint flags,
        IntPtr environment,string cwd,ref Startup startup,out ProcessInfo info);

    static string Quote(string s) {
        var b = new StringBuilder("\""); int slashes=0;
        foreach(char c in s) {
            if(c=='\\') { slashes++; continue; }
            if(c=='\"') { b.Append('\\',slashes*2+1); b.Append(c); slashes=0; continue; }
            b.Append('\\',slashes); slashes=0; b.Append(c);
        }
        b.Append('\\',slashes*2); b.Append('"'); return b.ToString();
    }
    public static int Run(string exe,string[] args,int ownerPid,int timeout) {
        IntPtr job=IntPtr.Zero,owner=IntPtr.Zero; ProcessInfo child=new ProcessInfo(); bool assigned=false;
        try {
            if(timeout<1 || timeout>120000) return 125;
            owner=OpenProcess(0x00100000,false,ownerPid);
            if(owner==IntPtr.Zero || WaitForSingleObject(owner,0)!=258) return 125;
            job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) return 125;
            var limits=new Extended(); limits.basic.flags=0x00002000; // KILL_ON_JOB_CLOSE
            if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Extended)))) return 125;
            var startup=new Startup(); startup.size=(uint)Marshal.SizeOf(typeof(Startup)); startup.flags=0x100;
            startup.input=GetStdHandle(-10); startup.output=GetStdHandle(-11); startup.error=GetStdHandle(-12);
            var cmd=new StringBuilder(Quote(exe)); foreach(var arg in args) cmd.Append(" "+Quote(arg));
            // No shell expands target arguments. Parent environment supplies secrets.
            if(!CreateProcess(exe,cmd,IntPtr.Zero,IntPtr.Zero,true,0x00000004|0x08000000,
                IntPtr.Zero,Environment.CurrentDirectory,ref startup,out child)) return 125;
            if(!AssignProcessToJobObject(job,child.process)) { TerminateProcess(child.process,125); return 125; }
            assigned=true;
            if(ResumeThread(child.thread)==0xffffffff) return 125;
            var clock=Stopwatch.StartNew(); uint code=125;
            while(true) {
                if(WaitForSingleObject(owner,0)==0) { code=124; break; }
                if(WaitForSingleObject(child.process,50)==0) {
                    if(!GetExitCodeProcess(child.process,out code)) code=125; break;
                }
                if(clock.ElapsedMilliseconds>=timeout) { code=124; break; }
            }
            // Also terminate orphaned descendants after a naturally exiting root.
            if(!TerminateJobObject(job,code)) return 125;
            var drain=Stopwatch.StartNew();
            while(drain.ElapsedMilliseconds<5000) {
                Accounting status;
                if(!QueryInformationJobObject(job,1,out status,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)) return 125;
                if(status.active==0) return unchecked((int)code);
                System.Threading.Thread.Sleep(20);
            }
            return 125;
        } finally {
            if(child.process!=IntPtr.Zero && !assigned) TerminateProcess(child.process,125);
            if(job!=IntPtr.Zero) CloseHandle(job);
            if(child.thread!=IntPtr.Zero) CloseHandle(child.thread);
            if(child.process!=IntPtr.Zero) CloseHandle(child.process);
            if(owner!=IntPtr.Zero) CloseHandle(owner);
        }
    }
}
'@
    $taskCommand = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
    $taskExit = [PaymentPgJob]::Run([string]$taskCommand.exe, [string[]]$taskCommand.args, $OwnerPid, $TimeoutMs)
    exit $taskExit
} catch {
    # Compilation/startup errors never echo payloads or environment values.
    [Console]::Error.WriteLine('CHILD_GUARD_BLOCKED')
    exit 125
}
