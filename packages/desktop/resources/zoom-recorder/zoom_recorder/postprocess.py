"""Tidy recognised text: acronyms, known terms, filler words, stray capitals.

Every step is conservative by design. Anything ambiguous is left alone rather than
guessed at, because a wrong "correction" is worse than a raw transcript.
"""

import re

# Function words that Parakeet sometimes capitalises mid-sentence. "I" is never here.
MIDSENTENCE = ("and", "but", "or", "so", "then", "the", "that", "with", "for",
               "of", "in", "on", "at", "an", "a", "to")

_ACRONYM = re.compile(r"\b((?:[A-Z] )+[A-Z])( ?'?s)?\b")
_MIDCAP = re.compile(r"([^.!?:\n]\s+)(%s)\b"
                     % "|".join(w.capitalize() for w in MIDSENTENCE))


def fix_acronyms(text):
    """Join spelled-out capitals: "P D P s" -> "PDPs", "S S O's" -> "SSOs"."""
    def repl(m):
        letters = m.group(1).split()
        # "Plan B I think" must not collapse to "BI"; a trailing lone "I" is a word.
        if len(letters) == 2 and letters[1] == "I":
            return m.group(0)
        joined = "".join(letters)
        return joined + "s" if m.group(2) else joined

    return _ACRONYM.sub(repl, text)


def fix_midsentence_caps(text):
    """Lowercase function words capitalised in the middle of a sentence."""
    return _MIDCAP.sub(lambda m: m.group(1) + m.group(2).lower(), text)


def apply_terms(text, terms):
    """Replace known mis-hearings with their canonical spelling."""
    for wrong, right in terms.items():
        text = re.sub(r"\b%s\b" % re.escape(wrong), right, text, flags=re.IGNORECASE)
    return text


def remove_fillers(text, fillers):
    """Drop standalone filler words, then repair the punctuation left behind."""
    if not fillers:
        return text
    pattern = r"(?i)\b(?:%s)\b,?" % "|".join(re.escape(f) for f in fillers)
    out = re.sub(pattern, "", text)
    return tidy(out)


def tidy(text):
    """Collapse the whitespace and dangling punctuation edits leave behind."""
    out = re.sub(r"\s+", " ", text)
    out = re.sub(r"\s+([,.!?;:])", r"\1", out)
    out = re.sub(r"([,;:])(\s*[,;:])+", r"\1", out)
    out = re.sub(r"^[\s,;:]+", "", out)
    out = out.strip()
    if out and out[0].isalpha():
        out = out[0].upper() + out[1:]
    return out


def clean(text, cfg):
    """Run the enabled cleanups over one segment of recognised text."""
    if not text:
        return text
    if cfg.get("fix_acronyms", True):
        text = fix_acronyms(text)
    terms = cfg.get("terms") or {}
    if cfg.get("fix_terms", True) and terms:
        text = apply_terms(text, terms)
    if cfg.get("remove_fillers", True):
        text = remove_fillers(text, cfg.get("fillers") or ())
    if cfg.get("fix_midsentence_caps", True):
        text = fix_midsentence_caps(text)
    return tidy(text)
