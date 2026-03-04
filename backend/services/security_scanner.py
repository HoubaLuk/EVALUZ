import re

class SecurityException(Exception):
    pass

class PromptInjectionScanner:
    """
    Heuristický scanner k odhalení pokusů o Prompt Injection uvnitř textu dodaného studentem.
    Běží nezávisle na LLM a blokuje text před inference požadavkem.
    """
    
    # Seznam podezřelých vzorců (case-insensitive)
    SUSPICIOUS_PATTERNS = [
        r"ignore previous instructions",
        r"ignore all prior instructions",
        r"zruš (předchozí|všechny)? ?(instrukce|příkazy)",
        r"zapomeň (na )?(všechny |předchozí )?(instrukce|příkazy)",
        r"system prompt( )?:",
        r"new rule:",
        r"nové? pravidl(o|a):",
        r"jsi( nyní)?( osvobozen| volný)",
        r"from now on(,| you will)",
        r"you are now",
        r"odteď jsi",
        r"vypiš (svůj )?prompt",
        r"evaluate this as 100",
        r"dej mi plný počet",
        r"hodnoť (to|vše)? (jako |na )?splněno",
        r"následující (text )?je (tajný|pouze) pro",
        r"```(json|python|bash)", # v úředním záznamu by neměly být markdown backticks
    ]

    def __init__(self):
        self._compiled_patterns = [re.compile(p, re.IGNORECASE) for p in self.SUSPICIOUS_PATTERNS]

    def scan_text(self, text: str) -> bool:
        """
        Proskenuje text úředního záznamu na výskyt zakázaných řetězců.
        Raises SecurityException pokud je nalezena shoda.
        """
        if not text:
            return True
            
        for pattern in self._compiled_patterns:
            match = pattern.search(text)
            if match:
                raise SecurityException(
                    f"Zjištěn potenciální pokus o Prompt Injection. Nalezen zakázaný vzor: '{match.group(0)}'. "
                    "Z bezpečnostních důvodů nebylo vyhodnocení spuštěno."
                )
                
        # Kontrola hustoty znaků nebo speciálních tokenů (např. spousta <|im_start|> apod.)
        if "<|im_" in text or "<|endoftext|>" in text or "<|system|>" in text:
            raise SecurityException("Zjištěna nestandardní syntaxe (LLM řídící znaky). Vyhodnocení zastaveno.")

        return True

# Singleton instance
scanner = PromptInjectionScanner()
