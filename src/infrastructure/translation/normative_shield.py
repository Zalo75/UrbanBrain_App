import re
from typing import Dict, List, Tuple, Any
from collections import Counter

class NormativeShield:
    """
    Deterministic protection layer for urban planning & legal norms.
    Masks sensitive normative tokens before Machine Translation and restores them exactly.
    Fails closed if any invariant is violated.
    """
    
    # Precompiled regexes ordered by specificity (most specific first)
    PROTECTED_PATTERNS = [
        # 1. Urban planning ordinance codes, height codes, zoning acronyms
        r'\b(?:ORDENANZA[-_]\d+|ORDENANÇA[-_]\d+|ORDENANTZA[-_]\d+|SU[-_][A-Z]+[-_]\d+|[A-Z]{1,4}[-_]\d+|PB\+\d+|B\+\d+|SNRSC|SUND|SUNC|SU-ORD|SU-DEL|[0-9]{1,2}[a-z])\b',
        
        # 2. Numbers with complex urbanistic units, surfaces, lengths & percentages
        r'\b\d+(?:[.,]\d+)*(?:\s*(?:m²t/m²s|m²st/m²s|m²/m²|m²t|m²s|m²|m³|metros|meters|metroko|km|ha))\b',
        r'\b\d+(?:[.,]\d+)*\s*m\b',
        r'\b\d+(?:[.,]\d+)*\s*%',
        
        # 3. Article and section decimal numbering: e.g., 142.3, 18.2.1
        r'\b\d+(?:\.\d+)+\b',
        
        # 4. Formatted thousands numbers: e.g., 2.000, 10.000
        r'\b\d{1,3}(?:\.\d{3})+\b',
        
        # 5. Standalone numbers (integers & decimals)
        r'\b\d+(?:,\d+)?\b'
    ]
    
    COMBINED_REGEX = re.compile('|'.join(f'({p})' for p in PROTECTED_PATTERNS), re.IGNORECASE)
    # Match both ZUB{i}Z and XUB{i}X placeholders
    PLACEHOLDER_REGEX = re.compile(r'\b[XZ]UB\d+[XZ]\b')

    @classmethod
    def protect(cls, text: str) -> Tuple[str, Dict[str, str], List[Dict[str, Any]]]:
        """
        Scans text, extracts normative entities without overlap, and substitutes ZUB{i}Z placeholders.
        """
        matches = []
        for match in cls.COMBINED_REGEX.finditer(text):
            matches.append((match.start(), match.end(), match.group(0)))
            
        # Deduplicate/resolve overlapping spans (favor longer span)
        filtered_spans = []
        for start, end, val in sorted(matches, key=lambda x: (x[0], -(x[1] - x[0]))):
            if not filtered_spans:
                filtered_spans.append((start, end, val))
            else:
                last_start, last_end, _ = filtered_spans[-1]
                if start >= last_end:
                    filtered_spans.append((start, end, val))
                elif end > last_end and (end - start) > (last_end - last_start):
                    filtered_spans[-1] = (start, end, val)

        # Build protected text and mapping using ZUB{i}Z
        mapping: Dict[str, str] = {}
        metadata: List[Dict[str, Any]] = []
        
        protected_parts = []
        last_idx = 0
        
        for i, (start, end, val) in enumerate(filtered_spans):
            placeholder = f"ZUB{i}Z"
            mapping[placeholder] = val
            metadata.append({
                "placeholder": placeholder,
                "original_value": val,
                "start": start,
                "end": end
            })
            protected_parts.append(text[last_idx:start])
            protected_parts.append(placeholder)
            last_idx = end
            
        protected_parts.append(text[last_idx:])
        protected_text = ''.join(protected_parts)
        
        return protected_text, mapping, metadata

    @classmethod
    def restore(cls, translated_text: str, mapping: Dict[str, str]) -> str:
        """
        Substitutes placeholders in translated text back with their exact original values.
        """
        restored = translated_text
        for placeholder, original_val in mapping.items():
            restored = restored.replace(placeholder, original_val)
        return restored

    @classmethod
    def verify_fail_closed(
        cls, 
        original_text: str, 
        translated_protected: str, 
        restored_text: str, 
        mapping: Dict[str, str]
    ) -> Dict[str, Any]:
        """
        Rigorous fail-closed verification.
        Validates:
        1. All placeholders were present in translated text (no placeholder dropped by MT).
        2. No placeholder was duplicated in translated text.
        3. No placeholder remnants remain in restored text.
        4. Every protected entity occurs in restored_text with exact frequency as in original_text.
        """
        violations = []
        
        # Check 1 & 2: Placeholder integrity in translated_protected
        found_placeholders = cls.PLACEHOLDER_REGEX.findall(translated_protected)
        placeholder_counts = Counter(found_placeholders)
        
        for ph in mapping.keys():
            count = placeholder_counts.get(ph, 0)
            if count == 0:
                violations.append(f"DROPPED_PLACEHOLDER: MT dropped {ph} ('{mapping[ph]}')")
            elif count > 1:
                violations.append(f"DUPLICATED_PLACEHOLDER: MT duplicated {ph} ('{mapping[ph]}') {count} times")
                
        # Check unexpected extra placeholders
        for ph in placeholder_counts.keys():
            if ph not in mapping:
                violations.append(f"HALLUCINATED_PLACEHOLDER: MT generated unknown placeholder {ph}")
                
        # Check 3: Remnants in restored text
        remnants = cls.PLACEHOLDER_REGEX.findall(restored_text)
        if remnants:
            violations.append(f"UNRESTORED_REMNANTS: Found unrestored placeholders {remnants}")
            
        # Check 4: Entity frequency check between original and restored
        for ph, orig_val in mapping.items():
            orig_freq = original_text.count(orig_val)
            rest_freq = restored_text.count(orig_val)
            if rest_freq < orig_freq:
                violations.append(f"MISSING_ENTITY: Protected entity '{orig_val}' count decreased ({orig_freq} -> {rest_freq})")
            elif rest_freq > orig_freq:
                violations.append(f"DUPLICATED_ENTITY: Protected entity '{orig_val}' count increased ({orig_freq} -> {rest_freq})")

        is_valid = len(violations) == 0
        return {
            "status": "VALID" if is_valid else "FAIL_CLOSED",
            "is_valid": is_valid,
            "violations": violations,
            "placeholders_count": len(mapping)
        }
