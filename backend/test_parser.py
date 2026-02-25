import sys
import os
sys.path.append(os.path.dirname(__file__))

from services.criteria_service import parse_criteria_markdown

sample1 = """Rozumím, zde jsou upravená kritéria:

**1. Kritérium:** Včasnost
Policista dorazil včas.

**2. Kritérium: Správnost**
Vše bylo správně. (1 bod)

3. Kritérium: Zákonnost postupu
Dle § 40. Bodů: 5
"""

print("=== SAMPLE 1 ===")
res1 = parse_criteria_markdown(sample1)
for r in res1: print(r)

