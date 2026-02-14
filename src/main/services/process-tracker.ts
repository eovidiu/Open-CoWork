interface TrackedProcess {
  pid: number
  command: string
  startedAt: Date
}

class ProcessTracker {
  private processes: Map<number, TrackedProcess> = new Map()

  track(pid: number, command: string): void {
    this.processes.set(pid, { pid, command, startedAt: new Date() })
  }

  untrack(pid: number): void {
    this.processes.delete(pid)
  }

  getActive(): TrackedProcess[] {
    return Array.from(this.processes.values())
  }

  killAll(): { killed: number[]; failed: number[] } {
    const killed: number[] = []
    const failed: number[] = []
    const pidsToKill = Array.from(this.processes.keys())

    if (pidsToKill.length === 0) {
      return { killed, failed }
    }

    const isWindows = process.platform === 'win32'

    // Send SIGTERM to all tracked processes
    for (const pid of pidsToKill) {
      try {
        if (isWindows) {
          process.kill(pid, 'SIGTERM')
        } else {
          // Kill the process group (negative PID) on POSIX
          process.kill(-pid, 'SIGTERM')
        }
        killed.push(pid)
      } catch {
        // Process already exited or we lack permission — either way, clean up
        failed.push(pid)
        this.processes.delete(pid)
      }
    }

    // Schedule SIGKILL for any processes still alive after 5 seconds
    if (killed.length > 0) {
      const remainingPids = [...killed]
      setTimeout(() => {
        for (const pid of remainingPids) {
          // Only send SIGKILL if we're still tracking this process
          if (!this.processes.has(pid)) continue
          try {
            if (isWindows) {
              process.kill(pid, 'SIGKILL')
            } else {
              process.kill(-pid, 'SIGKILL')
            }
          } catch {
            // Already exited — ignore
          }
          this.processes.delete(pid)
        }
      }, 5000)
    }

    return { killed, failed }
  }
}

export const processTracker = new ProcessTracker()

// Export the class for testing
export { ProcessTracker }
