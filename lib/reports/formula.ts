// Tiny safe formula evaluator for computed report columns.
// Grammar: numbers, parentheses, + - * /, and column references like
// [Label] which resolve through a label→key map. No identifiers, no
// function calls — keeps the surface small enough that we don't need
// a sandboxed JS eval. Output is always a number (NaN on failure).

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'ref'; label: string }

const PRECEDENCE: Record<'+' | '-' | '*' | '/', number> = {
  '+': 1, '-': 1, '*': 2, '/': 2,
}

/** Tokenize a formula string. Throws on unrecognized characters /
 *  unterminated [bracket] references so the builder can surface a
 *  validation error before saving. */
export function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue }
    if (c === '(') { out.push({ kind: 'lparen' }); i++; continue }
    if (c === ')') { out.push({ kind: 'rparen' }); i++; continue }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      out.push({ kind: 'op', value: c }); i++; continue
    }
    if (c === '[') {
      const end = src.indexOf(']', i + 1)
      if (end === -1) throw new Error(`Unterminated reference at position ${i}`)
      const label = src.slice(i + 1, end).trim()
      if (!label) throw new Error(`Empty [] reference at position ${i}`)
      out.push({ kind: 'ref', label })
      i = end + 1
      continue
    }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i + 1
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++
      const n = Number(src.slice(i, j))
      if (!Number.isFinite(n)) throw new Error(`Invalid number at position ${i}`)
      out.push({ kind: 'num', value: n })
      i = j
      continue
    }
    throw new Error(`Unexpected character '${c}' at position ${i}`)
  }
  return out
}

/** Shunting-yard: infix tokens → RPN. Unary minus is handled by
 *  rewriting `-x` to `0 - x` and `(-x)` to `(0-x)` at the parse step
 *  (good enough for v1; full unary parsing isn't worth the complexity). */
function toRpn(tokens: Token[]): Token[] {
  // Apply the unary-minus rewrite up front: a '-' that appears at the
  // start, or right after another op or '(', is unary.
  const rewritten: Token[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind === 'op' && t.value === '-') {
      const prev = rewritten[rewritten.length - 1]
      const isUnary = !prev || prev.kind === 'op' || prev.kind === 'lparen'
      if (isUnary) {
        rewritten.push({ kind: 'num', value: 0 })
      }
    }
    rewritten.push(t)
  }

  const out: Token[] = []
  const stack: Token[] = []
  for (const t of rewritten) {
    if (t.kind === 'num' || t.kind === 'ref') { out.push(t); continue }
    if (t.kind === 'op') {
      while (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.kind !== 'op') break
        if (PRECEDENCE[top.value] >= PRECEDENCE[t.value]) {
          out.push(stack.pop()!)
        } else break
      }
      stack.push(t)
      continue
    }
    if (t.kind === 'lparen') { stack.push(t); continue }
    if (t.kind === 'rparen') {
      while (stack.length > 0 && stack[stack.length - 1].kind !== 'lparen') {
        out.push(stack.pop()!)
      }
      if (stack.length === 0) throw new Error('Unmatched )')
      stack.pop()  // discard '('
    }
  }
  while (stack.length > 0) {
    const top = stack.pop()!
    if (top.kind === 'lparen') throw new Error('Unmatched (')
    out.push(top)
  }
  return out
}

/** Compile a formula once into a reusable evaluator. Throws on parse
 *  errors; the returned function never throws — bad refs / type errors
 *  resolve to NaN so a single bad row doesn't kill the whole report. */
export type Resolver = (label: string) => unknown
export type Evaluator = (resolve: Resolver) => number

export function compile(formula: string): Evaluator {
  const rpn = toRpn(tokenize(formula))
  return (resolve: Resolver) => {
    const stack: number[] = []
    for (const t of rpn) {
      if (t.kind === 'num') { stack.push(t.value); continue }
      if (t.kind === 'ref') {
        const v = resolve(t.label)
        const n = typeof v === 'number' ? v : Number(v)
        stack.push(Number.isFinite(n) ? n : NaN)
        continue
      }
      if (t.kind === 'op') {
        const b = stack.pop() ?? NaN
        const a = stack.pop() ?? NaN
        switch (t.value) {
          case '+': stack.push(a + b); break
          case '-': stack.push(a - b); break
          case '*': stack.push(a * b); break
          case '/': stack.push(b === 0 ? NaN : a / b); break
        }
      }
    }
    const result = stack.pop()
    return typeof result === 'number' && Number.isFinite(result) ? result : NaN
  }
}

/** True if a formula parses. Used by the builder to surface inline
 *  validation without mounting an actual evaluator. */
export function validateFormula(formula: string): { ok: true } | { ok: false; error: string } {
  try {
    compile(formula)
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Invalid formula' }
  }
}
