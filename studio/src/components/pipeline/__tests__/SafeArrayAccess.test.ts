/**
 * SafeArrayAccess.test.ts
 *
 * RED Phase Tests for Issue mondodb-bvh5: Safe Array Access Without Non-Null Assertions
 *
 * This test file verifies that array access patterns in PipelineCanvas are safe
 * and do not rely on non-null assertions (!) which can cause runtime errors.
 *
 * Problem: Lines 530 and 538 in PipelineCanvas.tsx use non-null assertions:
 *   - Line 530: onStageSelect?.(stages[selectedIndex + 1]!.id)
 *   - Line 538: onStageSelect?.(stages[selectedIndex - 1]!.id)
 *
 * These patterns are unsafe because:
 * 1. TypeScript non-null assertions bypass type safety checks
 * 2. Array bounds checks can be wrong if logic changes
 * 3. Concurrent modifications can cause undefined access
 * 4. Sparse arrays or proxy-wrapped arrays can return undefined unexpectedly
 *
 * Safe alternatives:
 * - Optional chaining: stages[selectedIndex + 1]?.id
 * - Array.at() method: stages.at(selectedIndex + 1)?.id
 * - Explicit null checks before access
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// Utility function to safely access array elements
function safeArrayAccess<T>(arr: T[], index: number): T | undefined {
  if (index < 0 || index >= arr.length) {
    return undefined
  }
  return arr[index]
}

// Simulates the behavior expected from PipelineCanvas keyboard navigation
function simulateKeyboardNavigation(
  stages: Array<{ id: string }>,
  selectedId: string | null,
  direction: 'up' | 'down'
): string | undefined {
  if (!selectedId) return undefined

  const selectedIndex = stages.findIndex((s) => s.id === selectedId)
  if (selectedIndex === -1) return undefined

  if (direction === 'down') {
    // UNSAFE: stages[selectedIndex + 1]!.id (current implementation)
    // SAFE: stages[selectedIndex + 1]?.id or stages.at(selectedIndex + 1)?.id
    const nextStage = stages[selectedIndex + 1]
    return nextStage?.id
  } else {
    // UNSAFE: stages[selectedIndex - 1]!.id (current implementation)
    // SAFE: stages[selectedIndex - 1]?.id or stages.at(selectedIndex - 1)?.id
    const prevStage = stages[selectedIndex - 1]
    return prevStage?.id
  }
}

describe('SafeArrayAccess', () => {
  // Path to the source file being tested
  const sourceFilePath = path.join(__dirname, '../PipelineCanvas.tsx')

  describe('source code analysis', () => {
    it('should not use non-null assertions on array access in keyboard handler', () => {
      const sourceCode = fs.readFileSync(sourceFilePath, 'utf8')

      // Find non-null assertions specifically on array indexing
      const unsafePatterns = [
        /stages\[selectedIndex \+ 1\]!/g,
        /stages\[selectedIndex - 1\]!/g,
        /stages\[\w+\]!\.id/g,
      ]

      const foundUnsafePatterns: string[] = []
      for (const pattern of unsafePatterns) {
        const matches = sourceCode.match(pattern)
        if (matches) {
          foundUnsafePatterns.push(...matches)
        }
      }

      // This test will FAIL in RED phase - there ARE unsafe patterns in the code
      expect(foundUnsafePatterns).toEqual([])
    })

    it('should use optional chaining for array element access', () => {
      const sourceCode = fs.readFileSync(sourceFilePath, 'utf8')

      // Extract keyboard handler section
      const keyboardHandlerStart = sourceCode.indexOf('const handleKeyDown = useCallback')
      const keyboardHandlerEnd = sourceCode.indexOf(
        '[selectedStageId, stages, removeStage, duplicateStage, moveStageUp, moveStageDown, onStageSelect]'
      )

      if (keyboardHandlerStart === -1 || keyboardHandlerEnd === -1) {
        throw new Error('Could not find handleKeyDown handler in source')
      }

      const keyboardHandler = sourceCode.slice(keyboardHandlerStart, keyboardHandlerEnd)

      // Check for safe patterns in ArrowDown handling
      const hasArrowDownSafeAccess =
        keyboardHandler.includes('stages[selectedIndex + 1]?.id') ||
        keyboardHandler.includes('stages.at(selectedIndex + 1)?.id') ||
        keyboardHandler.includes('const nextStage = stages[selectedIndex + 1]')

      // Check for safe patterns in ArrowUp handling
      const hasArrowUpSafeAccess =
        keyboardHandler.includes('stages[selectedIndex - 1]?.id') ||
        keyboardHandler.includes('stages.at(selectedIndex - 1)?.id') ||
        keyboardHandler.includes('const prevStage = stages[selectedIndex - 1]')

      // This test will FAIL in RED phase
      expect(hasArrowDownSafeAccess).toBe(true)
      expect(hasArrowUpSafeAccess).toBe(true)
    })

    it('should guard against undefined before calling onStageSelect', () => {
      const sourceCode = fs.readFileSync(sourceFilePath, 'utf8')

      // The code should check if the stage exists before accessing id
      // Either through optional chaining or explicit checks

      // Look for patterns like:
      // if (stages[selectedIndex + 1]) { onStageSelect(stages[selectedIndex + 1].id) }
      // OR
      // const next = stages[selectedIndex + 1]; if (next) onStageSelect(next.id)
      // OR
      // onStageSelect?.(stages[selectedIndex + 1]?.id) with proper undefined filtering

      const hasSafeArrowDownGuard =
        // Checks for safe pattern: uses optional chaining and bounds check
        // Pattern: if (selectedIndex < stages.length - 1 [&& nextStageId])
        /if\s*\(\s*selectedIndex\s*<\s*stages\.length\s*-\s*1/.test(sourceCode) &&
        // Must NOT use non-null assertion
        !/onStageSelect\?\.\(stages\[selectedIndex \+ 1\]!/.test(sourceCode)

      const hasSafeArrowUpGuard =
        // Pattern: if (selectedIndex > 0 [&& prevStageId])
        /if\s*\(\s*selectedIndex\s*>\s*0/.test(sourceCode) &&
        !/onStageSelect\?\.\(stages\[selectedIndex - 1\]!/.test(sourceCode)

      // Check that the guards protect against undefined
      // The current code has guards BUT still uses ! which is inconsistent
      expect(hasSafeArrowDownGuard).toBe(true)
      expect(hasSafeArrowUpGuard).toBe(true)
    })
  })

  describe('empty array handling', () => {
    it('returns undefined for any access on empty array', () => {
      const emptyArray: Array<{ id: string }> = []

      expect(safeArrayAccess(emptyArray, 0)).toBeUndefined()
      expect(safeArrayAccess(emptyArray, 1)).toBeUndefined()
      expect(safeArrayAccess(emptyArray, -1)).toBeUndefined()
    })

    it('keyboard navigation returns undefined for empty stages', () => {
      const emptyStages: Array<{ id: string }> = []

      expect(simulateKeyboardNavigation(emptyStages, null, 'down')).toBeUndefined()
      expect(simulateKeyboardNavigation(emptyStages, 'any-id', 'down')).toBeUndefined()
      expect(simulateKeyboardNavigation(emptyStages, 'any-id', 'up')).toBeUndefined()
    })
  })

  describe('single element array handling', () => {
    const singleStage = [{ id: 'only-stage' }]

    it('returns undefined when navigating down from only element', () => {
      const result = simulateKeyboardNavigation(singleStage, 'only-stage', 'down')
      expect(result).toBeUndefined()
    })

    it('returns undefined when navigating up from only element', () => {
      const result = simulateKeyboardNavigation(singleStage, 'only-stage', 'up')
      expect(result).toBeUndefined()
    })

    it('does not throw when accessing beyond bounds', () => {
      expect(() => simulateKeyboardNavigation(singleStage, 'only-stage', 'down')).not.toThrow()
      expect(() => simulateKeyboardNavigation(singleStage, 'only-stage', 'up')).not.toThrow()
    })
  })

  describe('boundary access patterns', () => {
    const stages = [{ id: 'first' }, { id: 'second' }, { id: 'third' }]

    it('navigates down from first element safely', () => {
      expect(simulateKeyboardNavigation(stages, 'first', 'down')).toBe('second')
    })

    it('navigates up from last element safely', () => {
      expect(simulateKeyboardNavigation(stages, 'third', 'up')).toBe('second')
    })

    it('returns undefined when navigating down from last element', () => {
      expect(simulateKeyboardNavigation(stages, 'third', 'down')).toBeUndefined()
    })

    it('returns undefined when navigating up from first element', () => {
      expect(simulateKeyboardNavigation(stages, 'first', 'up')).toBeUndefined()
    })
  })

  describe('out-of-bounds index access', () => {
    const stages = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    it('handles access at exactly array length', () => {
      expect(safeArrayAccess(stages, stages.length)).toBeUndefined()
    })

    it('handles access beyond array length', () => {
      expect(safeArrayAccess(stages, stages.length + 1)).toBeUndefined()
      expect(safeArrayAccess(stages, stages.length + 100)).toBeUndefined()
    })

    it('handles negative index access', () => {
      expect(safeArrayAccess(stages, -1)).toBeUndefined()
      expect(safeArrayAccess(stages, -100)).toBeUndefined()
    })

    it('handles index at length minus one (last valid index)', () => {
      expect(safeArrayAccess(stages, stages.length - 1)).toEqual({ id: 'c' })
    })
  })

  describe('undefined selectedId handling', () => {
    const stages = [{ id: 'test' }]

    it('returns undefined when selectedId is null', () => {
      expect(simulateKeyboardNavigation(stages, null, 'down')).toBeUndefined()
      expect(simulateKeyboardNavigation(stages, null, 'up')).toBeUndefined()
    })

    it('returns undefined when selectedId does not exist in array', () => {
      expect(simulateKeyboardNavigation(stages, 'non-existent', 'down')).toBeUndefined()
      expect(simulateKeyboardNavigation(stages, 'non-existent', 'up')).toBeUndefined()
    })
  })

  describe('sparse array handling', () => {
    it('handles sparse arrays without crashing', () => {
      // Create a sparse array
      const sparse: Array<{ id: string }> = []
      sparse[0] = { id: 'first' }
      sparse[2] = { id: 'third' } // Index 1 is empty

      // Safe access should handle this
      expect(safeArrayAccess(sparse, 0)).toEqual({ id: 'first' })
      expect(safeArrayAccess(sparse, 1)).toBeUndefined()
      expect(safeArrayAccess(sparse, 2)).toEqual({ id: 'third' })
    })

    it('does not throw on sparse array access', () => {
      const sparse: Array<{ id: string }> = []
      sparse[5] = { id: 'only' }

      expect(() => safeArrayAccess(sparse, 0)).not.toThrow()
      expect(() => safeArrayAccess(sparse, 3)).not.toThrow()
    })
  })

  describe('type safety verification', () => {
    const stages = [{ id: 'a' }, { id: 'b' }]

    it('returns correct type for valid access', () => {
      const result = safeArrayAccess(stages, 0)
      expect(result).toBeDefined()
      expect(typeof result?.id).toBe('string')
    })

    it('returns undefined (not null) for invalid access', () => {
      const result = safeArrayAccess(stages, 10)
      expect(result).toBeUndefined()
      expect(result).not.toBeNull()
    })

    it('allows optional chaining on result', () => {
      const result = safeArrayAccess(stages, 10)
      // This should not throw even though result is undefined
      expect(result?.id).toBeUndefined()
    })
  })

  describe('array mutation during access', () => {
    it('handles array being cleared', () => {
      const stages = [{ id: 'a' }, { id: 'b' }]
      const stagesCopy = [...stages]

      // Simulate the array being cleared
      stages.length = 0

      // Original reference now empty
      expect(safeArrayAccess(stages, 0)).toBeUndefined()
      // Copy still valid
      expect(safeArrayAccess(stagesCopy, 0)).toEqual({ id: 'a' })
    })

    it('handles array being replaced', () => {
      let stages = [{ id: 'original' }]
      const getCurrent = () => stages

      // Replace array
      stages = [{ id: 'replaced' }]

      expect(safeArrayAccess(getCurrent(), 0)?.id).toBe('replaced')
    })
  })

  describe('null/undefined element handling', () => {
    it('handles array with null elements', () => {
      const arrayWithNull = [{ id: 'first' }, null, { id: 'third' }] as Array<{ id: string } | null>

      const second = safeArrayAccess(arrayWithNull, 1)
      expect(second).toBeNull()

      // Optional chaining on null should return undefined
      expect(second?.id).toBeUndefined()
    })

    it('handles array with undefined elements', () => {
      const arrayWithUndefined = [{ id: 'first' }, undefined, { id: 'third' }] as Array<
        { id: string } | undefined
      >

      const second = safeArrayAccess(arrayWithUndefined, 1)
      expect(second).toBeUndefined()
    })
  })

  describe('performance characteristics', () => {
    it('safe access has O(1) time complexity', () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => ({ id: `stage-${i}` }))

      const startTime = performance.now()
      for (let i = 0; i < 10000; i++) {
        safeArrayAccess(largeArray, i)
      }
      const endTime = performance.now()

      // Should complete in reasonable time (less than 100ms for 10k accesses)
      expect(endTime - startTime).toBeLessThan(100)
    })

    it('boundary checking does not significantly impact performance', () => {
      const array = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

      const startTime = performance.now()
      for (let i = 0; i < 100000; i++) {
        // Mix of valid and invalid accesses
        safeArrayAccess(array, i % 5)
      }
      const endTime = performance.now()

      // Should complete in reasonable time
      expect(endTime - startTime).toBeLessThan(100)
    })
  })

  describe('real-world scenarios', () => {
    it('rapid navigation does not cause undefined access', () => {
      const stages = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }]
      let currentId: string | null = '3'
      const results: (string | undefined)[] = []

      // Simulate rapid up/down navigation
      for (let i = 0; i < 20; i++) {
        const direction = i % 2 === 0 ? 'down' : 'up'
        const nextId = simulateKeyboardNavigation(stages, currentId, direction)
        results.push(nextId)
        if (nextId) currentId = nextId
      }

      // No result should be an unexpected undefined that would crash if accessed
      expect(results.every((r) => r === undefined || typeof r === 'string')).toBe(true)
    })

    it('handles stage deletion during navigation', () => {
      const stages = [{ id: '1' }, { id: '2' }, { id: '3' }]
      const currentId = '3'

      // Delete the last stage
      stages.pop()

      // Navigation should now return undefined, not crash
      const result = simulateKeyboardNavigation(stages, currentId, 'up')
      // currentId '3' no longer exists, so should return undefined
      expect(result).toBeUndefined()
    })

    it('handles complete stage replacement', () => {
      let stages = [{ id: 'old-1' }, { id: 'old-2' }]
      const currentId = 'old-1'

      // Replace all stages
      stages = [{ id: 'new-1' }, { id: 'new-2' }]

      // Old ID should not be found
      const result = simulateKeyboardNavigation(stages, currentId, 'down')
      expect(result).toBeUndefined()
    })
  })

  describe('comparison with unsafe patterns', () => {
    it('demonstrates why non-null assertion is dangerous', () => {
      const stages: Array<{ id: string }> = []

      // UNSAFE: Would throw "Cannot read property 'id' of undefined"
      // const unsafeResult = stages[0]!.id

      // SAFE: Returns undefined
      const safeResult = stages[0]?.id

      expect(safeResult).toBeUndefined()
    })

    it('shows boundary check with non-null assertion is still unsafe', () => {
      const stages = [{ id: 'only' }]
      const selectedIndex = 0

      // Even with bounds check, non-null assertion is a code smell
      // if (selectedIndex < stages.length - 1) {
      //   onStageSelect(stages[selectedIndex + 1]!.id) // Still uses !
      // }

      // Better: Use optional chaining regardless of checks
      const nextId = stages[selectedIndex + 1]?.id
      expect(nextId).toBeUndefined()
    })

    it('verifies optional chaining behavior matches expectations', () => {
      const stages = [{ id: 'a' }, { id: 'b' }]

      // Standard array access returns undefined for out of bounds
      expect(stages[5]).toBeUndefined()

      // Optional chaining on undefined returns undefined
      expect(stages[5]?.id).toBeUndefined()

      // This should NOT throw
      expect(() => stages[5]?.id).not.toThrow()

      // But non-null assertion WOULD throw if we tried to access .id
      // expect(() => stages[5]!.id).toThrow() // This is commented because it would throw
    })
  })

  describe('integration verification', () => {
    it('PipelineCanvas source should not have vulnerable patterns', () => {
      const sourceCode = fs.readFileSync(sourceFilePath, 'utf8')

      // Count occurrences of unsafe array access with non-null assertion
      const unsafeAccessCount = (
        sourceCode.match(/stages\[(?:selectedIndex|index|\d+)\s*[+-]\s*\d+\]!/g) || []
      ).length

      // This test FAILS in RED phase - there are 2 unsafe accesses
      expect(unsafeAccessCount).toBe(0)
    })

    it('should have safe navigation guards', () => {
      const sourceCode = fs.readFileSync(sourceFilePath, 'utf8')

      // Check that boundary conditions are handled
      const hasDownBoundaryCheck = /selectedIndex\s*<\s*stages\.length\s*-\s*1/.test(sourceCode)
      const hasUpBoundaryCheck = /selectedIndex\s*>\s*0/.test(sourceCode)

      expect(hasDownBoundaryCheck).toBe(true)
      expect(hasUpBoundaryCheck).toBe(true)

      // But these checks should use safe access (optional chaining), not !
      // This will help identify the issue in RED phase
    })

    it('should use modern safe array access patterns', () => {
      const sourceCode = fs.readFileSync(sourceFilePath, 'utf8')

      // Modern patterns include:
      // 1. Optional chaining: arr[idx]?.prop
      // 2. Array.at(): arr.at(idx)?.prop
      // 3. Nullish coalescing with optional chaining

      const usesOptionalChaining =
        sourceCode.includes('stages[selectedIndex + 1]?.id') ||
        sourceCode.includes('stages[selectedIndex - 1]?.id')

      const usesAtMethod =
        sourceCode.includes('stages.at(selectedIndex + 1)?.id') ||
        sourceCode.includes('stages.at(selectedIndex - 1)?.id')

      // At least one modern pattern should be used
      // This test FAILS in RED phase
      expect(usesOptionalChaining || usesAtMethod).toBe(true)
    })
  })
})
