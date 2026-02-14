import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ProcessTracker } from '../../src/main/services/process-tracker'

describe('ProcessTracker', () => {
  let tracker: ProcessTracker

  beforeEach(() => {
    tracker = new ProcessTracker()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('track', () => {
    it('should track a process by pid', () => {
      tracker.track(1234, 'ls -la')

      const active = tracker.getActive()
      expect(active).toHaveLength(1)
      expect(active[0].pid).toBe(1234)
      expect(active[0].command).toBe('ls -la')
      expect(active[0].startedAt).toBeInstanceOf(Date)
    })

    it('should track multiple processes', () => {
      tracker.track(1000, 'echo hello')
      tracker.track(2000, 'cat file.txt')
      tracker.track(3000, 'git status')

      const active = tracker.getActive()
      expect(active).toHaveLength(3)
    })

    it('should overwrite if the same pid is tracked again', () => {
      tracker.track(1234, 'old command')
      tracker.track(1234, 'new command')

      const active = tracker.getActive()
      expect(active).toHaveLength(1)
      expect(active[0].command).toBe('new command')
    })
  })

  describe('untrack', () => {
    it('should remove a tracked process', () => {
      tracker.track(1234, 'ls')
      tracker.untrack(1234)

      expect(tracker.getActive()).toHaveLength(0)
    })

    it('should not throw when untracking a pid that was never tracked', () => {
      expect(() => tracker.untrack(9999)).not.toThrow()
    })

    it('should only remove the specified pid', () => {
      tracker.track(1000, 'a')
      tracker.track(2000, 'b')
      tracker.untrack(1000)

      const active = tracker.getActive()
      expect(active).toHaveLength(1)
      expect(active[0].pid).toBe(2000)
    })
  })

  describe('getActive', () => {
    it('should return empty array when nothing is tracked', () => {
      expect(tracker.getActive()).toEqual([])
    })

    it('should return all tracked processes', () => {
      tracker.track(100, 'cmd1')
      tracker.track(200, 'cmd2')

      const active = tracker.getActive()
      expect(active).toHaveLength(2)
      const pids = active.map((p) => p.pid)
      expect(pids).toContain(100)
      expect(pids).toContain(200)
    })
  })

  describe('killAll', () => {
    it('should return empty arrays when no processes are tracked', () => {
      const result = tracker.killAll()
      expect(result).toEqual({ killed: [], failed: [] })
    })

    it('should send SIGTERM to tracked processes', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

      tracker.track(1234, 'sleep 100')
      const result = tracker.killAll()

      expect(result.killed).toContain(1234)
      expect(result.failed).toHaveLength(0)
      expect(killSpy).toHaveBeenCalled()
    })

    it('should use negative PID for process group kill on POSIX', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

      tracker.track(1234, 'sleep 100')
      tracker.killAll()

      expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGTERM')

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('should use positive PID on Windows (no process groups)', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

      tracker.track(1234, 'sleep 100')
      tracker.killAll()

      expect(killSpy).toHaveBeenCalledWith(1234, 'SIGTERM')

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('should handle already-exited processes gracefully', () => {
      vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH: No such process')
      })

      tracker.track(1234, 'already done')
      const result = tracker.killAll()

      expect(result.killed).toHaveLength(0)
      expect(result.failed).toContain(1234)
      // Failed processes should be cleaned up
      expect(tracker.getActive()).toHaveLength(0)
    })

    it('should send SIGKILL after 5 seconds to processes still alive', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

      tracker.track(1234, 'stubborn process')
      tracker.killAll()

      // SIGTERM was sent
      expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGTERM')

      // Process is still tracked (not yet untracked by close event)
      // Advance 5 seconds
      vi.advanceTimersByTime(5000)

      // SIGKILL should have been sent
      expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGKILL')

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('should skip SIGKILL for processes that were untracked before timeout', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

      tracker.track(1234, 'quick process')
      tracker.killAll()

      // Simulate the process exiting before the 5s timeout
      tracker.untrack(1234)

      vi.advanceTimersByTime(5000)

      // SIGTERM was called, but SIGKILL should NOT have been called
      const sigkillCalls = killSpy.mock.calls.filter(
        (call) => call[1] === 'SIGKILL'
      )
      expect(sigkillCalls).toHaveLength(0)
    })

    it('should handle SIGKILL failure gracefully for already-exited processes', () => {
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin' })

      let callCount = 0
      vi.spyOn(process, 'kill').mockImplementation(() => {
        callCount++
        if (callCount > 1) {
          // SIGKILL fails because process already exited
          throw new Error('ESRCH: No such process')
        }
        return true
      })

      tracker.track(1234, 'process')
      tracker.killAll()

      // Should not throw when SIGKILL fails
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow()

      // Process should be cleaned up
      expect(tracker.getActive()).toHaveLength(0)

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('should kill multiple processes', () => {
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

      tracker.track(1000, 'cmd1')
      tracker.track(2000, 'cmd2')
      tracker.track(3000, 'cmd3')

      const result = tracker.killAll()

      expect(result.killed).toHaveLength(3)
      expect(result.killed).toContain(1000)
      expect(result.killed).toContain(2000)
      expect(result.killed).toContain(3000)
      expect(killSpy).toHaveBeenCalledTimes(3)
    })

    it('should handle mixed success and failure', () => {
      let callIndex = 0
      vi.spyOn(process, 'kill').mockImplementation(() => {
        callIndex++
        if (callIndex === 2) {
          throw new Error('ESRCH')
        }
        return true
      })

      tracker.track(1000, 'alive')
      tracker.track(2000, 'dead')
      tracker.track(3000, 'alive')

      const result = tracker.killAll()

      expect(result.killed).toHaveLength(2)
      expect(result.failed).toHaveLength(1)
      expect(result.failed).toContain(2000)
    })
  })
})
