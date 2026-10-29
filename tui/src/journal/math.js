// Simple LaTeX as Unicode, for formulas in a terminal: \sigma = 0.3 as σ = 0.3, x^2 as x², a_i as
// aᵢ, \frac{1}{2} as 1/2. Null for anything it can't write that way (a matrix, a superscript with
// no Unicode form), which then shows as its LaTeX. Spacing is the source's, as typed, less runs of
// spaces and the spaces just inside brackets.

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ',
  Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // Letter-like symbols, which sit in a formula as letters do.
  partial: '∂', nabla: '∇', hbar: 'ℏ', ell: 'ℓ', infty: '∞', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', emptyset: '∅',
};

const SYMBOLS = {
  times: '×', cdot: '⋅', pm: '±', mp: '∓', div: '÷', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', sim: '∼', simeq: '≃',
  cong: '≅', equiv: '≡', propto: '∝', ll: '≪', gg: '≫', perp: '⊥', parallel: '∥', mid: '∣',
  sum: '∑', prod: '∏', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪',
  cap: '∩', setminus: '∖', forall: '∀', exists: '∃', neg: '¬', lnot: '¬', land: '∧', wedge: '∧',
  lor: '∨', vee: '∨', oplus: '⊕', otimes: '⊗',
  to: '→', rightarrow: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔', Rightarrow: '⇒',
  Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹', iff: '⟺', mapsto: '↦', uparrow: '↑',
  downarrow: '↓', longrightarrow: '⟶', longleftarrow: '⟵',
  dots: '…', ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', prime: '′', angle: '∠', degree: '°',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', vert: '|', Vert: '‖',
  lbrace: '{', rbrace: '}',
};

// Named operators, written as their names.
const OPERATORS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'arg', 'deg',
  'gcd', 'Pr', 'mod', 'bmod',
]);

// Commands that only size or space what follows.
const SIZES = new Set(['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'displaystyle', 'textstyle']);
const SPACES = { ',': ' ', ':': ' ', ';': ' ', '>': ' ', ' ': ' ', '!': '', quad: ' ', qquad: '  ' };
const ESCAPED = new Set(['{', '}', '%', '$', '&', '#', '_', '|']);

// Text in a formula, as written.
const TEXT = new Set(['text', 'textrm', 'textit', 'textbf', 'mbox', 'operatorname']);
// Styles that Unicode can't show in plain letters: the letters as they are.
const STYLES = new Set(['mathrm', 'mathit', 'mathbf', 'boldsymbol', 'mathsf', 'mathtt', 'bm']);
const DOUBLE_STRUCK = { N: 'ℕ', Z: 'ℤ', Q: 'ℚ', R: 'ℝ', C: 'ℂ', P: 'ℙ', H: 'ℍ' };
const ACCENTS = { hat: '̂', bar: '̄', overline: '̅', vec: '⃗', dot: '̇', ddot: '̈', tilde: '̃' };

const table = (from, to) => Object.fromEntries([...from].map((c, i) => [c, [...to][i]]));
const SUP = table(
  '0123456789+−=()abcdefghijklmnoprstuvwxyzABDEGHIJKLMNOPRTUVWαβγδεθιφχ',
  '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂᵅᵝᵞᵟᵋᶿᶥᵠᵡ',
);
const SUB = table('0123456789+−=()aehijklmnoprstuvxβγρφχ', '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓᵦᵧᵨᵩᵪ');

class Unsupported extends Error {}
const fail = () => {
  throw new Unsupported();
};

// One term, for writing a fraction without parentheses: a number, a letter or symbol with
// scripts, no operators or spaces.
const isTerm = (s) => /^[\p{L}\p{N}.′\p{Mn}⁰-⁹ᵃ-ᶿ₀-ₜ]+$/u.test(s) || /^[\p{L}\p{N}]$/u.test(s);

export function latexToUnicode(latex) {
  const src = latex.trim();
  let i = 0;

  const skipSpaces = () => {
    while (/\s/.test(src[i] ?? '')) i++;
  };

  // A {group}'s contents, as written, for text.
  function rawGroup() {
    skipSpaces();
    if (src[i] !== '{') fail();
    let depth = 0;
    const start = i + 1;
    for (; i < src.length; i++) {
      if (src[i] === '\\') i++;
      else if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i++).replace(/\\([{}%$&#_ ])/g, '$1');
    }
    return fail();
  }

  function group() {
    i++;
    const out = sequence('}');
    if (src[i] !== '}') fail();
    i++;
    return out;
  }

  // What a command or a script takes: a {group}, a command, or a character.
  function argument() {
    skipSpaces();
    if (i >= src.length) fail();
    if (src[i] === '{') return group();
    if (src[i] === '\\') return command().text;
    return char(src[i++]);
  }

  function char(c) {
    if (c === '-') return '−';
    if (c === '*') return '∗';
    if (c === "'") return '′';
    if (c === '~') return ' ';
    if ('&#$%'.includes(c)) fail();
    return c;
  }

  function script(sup) {
    const text = argument().replace(/\s+/g, '');
    if (sup && text === '∘') return '°';
    if (/^′+$/.test(text)) return text;
    const map = sup ? SUP : SUB;
    return [...text].map((c) => map[c] ?? fail()).join('');
  }

  // A command, as { text, letter }: `letter` when it stands as a letter does, so a space after it
  // that only ended its name ("\mu m") goes.
  function command() {
    i++;
    let name = /^[a-zA-Z]+/.exec(src.slice(i))?.[0];
    if (name) i += name.length;
    else name = src[i++] ?? fail();
    if (name in SPACES) return { text: SPACES[name] };
    if (ESCAPED.has(name)) return { text: name };
    if (name in GREEK) return { text: GREEK[name], letter: true };
    if (name in SYMBOLS) return { text: SYMBOLS[name] };
    if (OPERATORS.has(name)) return { text: name };
    if (SIZES.has(name)) {
      skipSpaces();
      // \left. is no delimiter at all.
      if (src[i] === '.') i++;
      return { text: '' };
    }
    if (TEXT.has(name)) return { text: rawGroup() };
    if (STYLES.has(name)) return { text: argument() };
    if (name === 'mathbb') return { text: [...argument()].map((c) => DOUBLE_STRUCK[c] ?? fail()).join('') };
    if (name in ACCENTS) {
      const base = argument();
      if ([...base].length !== 1) fail();
      return { text: base + ACCENTS[name] };
    }
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const [top, bottom] = [argument().trim(), argument().trim()];
      const wrapped = (s) => (isTerm(s) ? s : `(${s})`);
      return { text: `${wrapped(top)}/${wrapped(bottom)}` };
    }
    if (name === 'sqrt') {
      skipSpaces();
      let root = '√';
      if (src[i] === '[') {
        const end = src.indexOf(']', i);
        const n = end > i ? src.slice(i + 1, end).trim() : fail();
        root = { 3: '∛', 4: '∜' }[n] ?? fail();
        i = end + 1;
      }
      const body = argument().trim();
      return { text: isTerm(body) ? root + body : `${root}(${body})` };
    }
    if (name === 'not') {
      const next = argument();
      return { text: { '=': '≠', '∈': '∉', '≡': '≢', '<': '≮', '>': '≯' }[next] ?? fail() };
    }
    return fail();
  }

  function sequence(end) {
    let out = '';
    while (i < src.length && src[i] !== end) {
      const c = src[i];
      if (c === '\\') {
        const { text, letter } = command();
        out += text;
        // A space that only ends a command's name, before a letter.
        if (letter && /\s/.test(src[i] ?? '') && /[a-zA-Z]/.test(src[i + 1] ?? '')) skipSpaces();
      } else if (c === '{') out += group();
      else if (c === '}') fail();
      else if (c === '^' || c === '_') {
        i++;
        out += script(c === '^');
      } else if (/\s/.test(c)) {
        skipSpaces();
        out += ' ';
      } else {
        i++;
        out += char(c);
      }
    }
    return out;
  }

  try {
    const out = sequence(null)
      .replace(/ +/g, ' ')
      // KaTeX sets brackets close to what they hold.
      .replace(/([([{⟨]) /g, '$1')
      .replace(/ ([)\]}⟩])/g, '$1');
    return out.trim() || null;
  } catch (err) {
    if (err instanceof Unsupported) return null;
    throw err;
  }
}
