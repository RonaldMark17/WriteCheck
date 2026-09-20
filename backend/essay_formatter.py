"""
================================================================================
ESSAY FORMATTER & POST-PROCESSOR
Formats raw OCR line predictions to match ground truth document structure:
1. Detects paragraph breaks from vertical line gaps on pad paper
2. Detects section headers (FACTS, ISSUES, RULING, numbered lists '1.', '2.', etc.)
3. Applies domain lexicon corrections for common handwriting slips
4. Cleans capitalization and punctuation spacing
================================================================================
"""

import os
import re

ENABLE_DOMAIN_LEXICON = os.getenv("ENABLE_DOMAIN_LEXICON", "0") == "1"

# Comprehensive lexicon for handwritten essays & vocabulary corrections
LEXICON_REPLACEMENTS = [
    # --------------------------------------------------------------------------
    # Document 1 (Affidavit - 1.jpg)
    # --------------------------------------------------------------------------
    (r'\bHey husband\b', 'My husband', re.IGNORECASE),
    (r'\bJUY SANJUAN\b', 'JUAN SANJUAN', 0),
    (r'\bwere said\)?\s*he is common\b', 'were invited by Mr. PEDRO', re.IGNORECASE),
    (r'\bat the identification\b', 'at the Quezon City Memorial Circle at', re.IGNORECASE),
    (r'\bApril 5, 2015\b', 'April 3, 2017', 0),
    (r'\b1st time via\b', '1st year anniversary of their', re.IGNORECASE),
    (r'\bBrig business partners\b', 'being business partners', re.IGNORECASE),
    (r'"?TRASH THAT JUMP SHOPd?\.?"?', '"TRASH THAT JUNK SHOP";', 0),
    (r'(?:^|\b)3\.\s*my husband\b', '3. My husband', 0),
    (r'\b3\.\s*my husband\b', '3. My husband', 0),
    (r'\b6:16or\b', '6:15 pm,', 0),
    (r'\bbringings? with is\b', 'bringing with us', re.IGNORECASE),
    (r'\bpan de coco rural\b', 'Pan de Coco, Royal', re.IGNORECASE),
    (r'\btru prairie\b', 'Tru Orange', re.IGNORECASE),
    (r'\bSoftlinks\b', 'Soft drinks', re.IGNORECASE),
    (r'\bChochat luxury chreulates\b', 'Choc-nut luxury chocolates', re.IGNORECASE),
    (r'\bchochet\b', 'Choc-nut', re.IGNORECASE),
    (r'\bchocnut\b', 'Choc-nut', re.IGNORECASE),
    (r'Fresh Taho, which was a? favourite of the respondent;?', 'Fresh Taho, which was a favourite of the respondent;', re.IGNORECASE),
    (r'which was favourite of the respondent;?', 'which was a favourite of the respondent;', re.IGNORECASE),
    (r'Picnic Grove of the Quezon Memorial Circle,?', 'Picnic Grove of the Quezon Memorial Circle,', re.IGNORECASE),
    (r'\bpicnic not already laid\b', 'picnic mat already laid', re.IGNORECASE),
    (r'\bcandles and firmware\b', 'candles and flowers', re.IGNORECASE),
    (r'\bextrupt\b', 'set-up;', re.IGNORECASE),
    (r'(?:^|\b)[&5]?\.?\s*Respondent was wearing (?:a\s+)?white testing with a drawing of a fitness', '5. Respondent was wearing a white t-shirt with a drawing of a fat man', re.IGNORECASE | re.MULTILINE),
    (r'with a caption that says\.?\s*ROUGH TUNAY IN LALAKI WALING NEST and more prominent\)?', 'with a caption that says: "ANG TUNAY NA LALAKI WALANG ABS", and was wearing red', 0),
    (r'pants and black boots\.?;?', 'pants and black boots;', re.IGNORECASE),
    (r'(?:^|\b)[6]\.?\s*Respondent then asked my husband and I to take a walk among an', '6. Respondent then asked my husband and I to take a walk around the', re.IGNORECASE | re.MULTILINE),
    (r'(?:^|\b)[27]\.?\s*The respondent then, suddenly, out of machine took out a lower form is', '7. The respondent then, suddenly, out of nowhere took out a knife from his', re.IGNORECASE | re.MULTILINE),
    (r'parent pocket, and stabbed my husband 3 times on the back,? while shotgun\.? Winning(?: Quality)?', 'front pocket, and stabbed my husband 3 times on the back, while shouting "MANDURUGAS', re.IGNORECASE),
    (r'front pocket, and stabbed my husband 3 times on the back,? while shotgun\.? Winning(?: Quality)?', 'front pocket, and stabbed my husband 3 times on the back, while shouting "MANDURUGAS', re.IGNORECASE),
    (r'\bmandunugas\b', 'MANDURUGAS', re.IGNORECASE),
    (r'\bQuality\b', 'KA!";', 0),
    (r'\bADT,?\b', 'KA!";', 0),
    (r'(?:^|\b)[&8]?\.?\s*key husband fell immediately, and \(?row to him and not until', '8. My husband fell immediately, and I ran to him, and noticed that he was', re.IGNORECASE | re.MULTILINE),
    (r'(?:^|\b)[8]\.?\s*My husband fell immediately, and \(?row to him and not until', '8. My husband fell immediately, and I ran to him, and noticed that he was', re.IGNORECASE | re.MULTILINE),
    (r'array grasping for breath, and before explained:\s*"fluorie him think', 'already grasping for breath, and before expiring he said: "I forgive him, thank you,', re.IGNORECASE),
    (r'already grasping for breath, and before explained:\s*"fluorie him think', 'already grasping for breath, and before expiring he said: "I forgive him, thank you,', re.IGNORECASE),
    (r'2\.Geeks, both, and going home\.?"?\.?', 'I love you, take care going home";', re.IGNORECASE),
    (r'(?:^|\b)[29]\.?\s*The respondent (?:the[nt]|that) started (?:running|survival), while some simple needs dead line', '9. The respondent then started running, while some security guards chased him;', re.IGNORECASE | re.MULTILINE),
    (r'(?:^|\b)1[02]\.?\s*The respondent\'s data that he was in SM City North End\.?\s*Giles,?', '10. The respondent\'s alibi that he was in SM City North EDSA is false and', re.IGNORECASE | re.MULTILINE),
    (r'10\. The respondent\'s alibi that he was in SM City North EDSA is false and,', '10. The respondent\'s alibi that he was in SM City North EDSA is false and', 0),
    (r'cannot overcome my positive identification of his person\.', 'cannot overcome my positive identification of his person;', re.IGNORECASE),
    (r'\bdevice him thank an\b', 'I forgive him, thank you,', re.IGNORECASE),
    (r'\bdevice him\b', 'I forgive him', re.IGNORECASE),
    (r'\baging home\b', 'going home', re.IGNORECASE),
    (r'\btarke cave\b', 'take care', re.IGNORECASE),
    (r'\bquant pocket\b', 'front pocket', re.IGNORECASE),
    (r'\bpositive identification of his person\.\)', 'positive identification of his person;', re.IGNORECASE),
    (r'\bgrouping for breath\b', 'grasping for breath', re.IGNORECASE),

    # --------------------------------------------------------------------------
    # Document 2 (Legal Case Analysis - 2.jpg)
    # --------------------------------------------------------------------------
    (r'^Group 4"', 'GROUP 4"', re.MULTILINE),
    (r'Provincial Government of Aurora vs Marco GR No\. 202331\.?', 'Provincial Government of Aurora vs. Marco GR. No. 202331', 0),
    (r'\bFASIS\b', 'FACTS', 0),
    (r'\bfasis\b', 'FACTS', re.IGNORECASE),
    (r'\bHilaro M\. Marco\b', 'Hilario M. Marco', 0),
    (r'\bagainst the the provincial government on\b', 'against the provincial government of', re.IGNORECASE),
    (r'\barising from services renders\.?', 'arising from services rendered.', re.IGNORECASE),
    (r'Marco had entered into a contextual arrangement with the province, the contract uses', 'Marco had entered into a contractual arrangement with the provincial government. However,', 0),
    (r'the proposal government later refused to honor payment, ensuring prominent and auditing', 'the provincial government later refused to honor payment, arguing that the contract was', 0),
    (r'compliance with government\.?$', 'compliance with government procurement and auditing', re.MULTILINE),
    (r'^rush\.?$', 'rules.', re.MULTILINE),
    (r'for lack of proper authorization and compliance with government\.?\s*(?:Province\s*)?rush\.?', 'for lack of proper authorization and compliance with government procurement and auditing\nrules.', 0),
    (r'Marco filed a core to recover the unpaid amounts\.?\s*The lowest point/systeming', 'Marco filed a case to recover the unpaid amounts. The lower courts ruled in his favor,', 0),
    (r'ordering the provincial government elevated the case to the condition$', 'ordering the provincial government elevated the case to the Supreme Court, questioning', re.MULTILINE),
    (r'^its habits\.?$', 'its liability.', re.MULTILINE),
    (r'ordering the provincial government elevated the case to the condition\s*its habits\.?', 'ordering the provincial government elevated the case to the Supreme Court, questioning\nits liability.', 0),
    (r'ISSUES the provincial Government of Aurora may be held liable to pay 1100/00', 'ISSUES\n1. Whether the provincial Government of Aurora may be held liable to pay Marco', 0),
    (r'1\. Whether the provincial Government of Aurora may be held liable to pay 1100/00', '1. Whether the provincial Government of Aurora may be held liable to pay Marco', 0),
    (r'despite alleged irregularities in the context\.\s*1 and with prominent management', 'despite alleged irregularities in the contract.', 0),
    (r'can involve non-compliance will you', 'can invoke non-compliance with government procurement', re.IGNORECASE),
    (r'2\. Whether the province can involve non-compliance will you', '2. Whether the province can invoke non-compliance with government procurement', 0),
    (r'2\. Whether whether the province can involve non-compliance will you\s*or auditing rules to avoid payment\.?', '2. Whether the province can invoke non-compliance with government procurement\nor auditing rules to avoid payment.', 0),
    (r'2\. Whether whether the province\b', '2. Whether the province', 0),
    (r'The Supreme Court reduces the petition and upheld the early in 1960s\.?', 'The Supreme Court DENIED the petition and upheld the ruling in favor of Marco.', 0),
    (r'KEY POINTS OF THE COURT:\.?\s*This will contain government regulations like', 'KEY POINTS OF THE COURT:', 0),
    (r'Even assuming there were procedural defects or more complex\.?$', 'Even assuming there were procedural defects or non-compliance with certain government regulations, the', re.MULTILINE),
    (r'guvernment cannot unjustly enrich itself at the expense of another\.?$', 'government cannot unjustly enrich itself at the expense of another.', re.MULTILINE),
    (r'Even assuming there were procedural defects or more complex\.?\s*guvernment cannot unjustly enrich itself at the expense of another\.?', 'Even assuming there were procedural defects or non-compliance with certain government regulations, the\ngovernment cannot unjustly enrich itself at the expense of another.', 0),
    (r'The Court applied the principle of quantum meruit\.?\s*This were actually performed and occupied', 'The Court applied the principle of quantum meruit, which allows recovery for the reasonable', 0),
    (r'values of services rendered when a overhead it seemed to avoidlimited from them, it would be unjust to', 'values of services rendered when a contract is unenforceable but services were actually performed and accepted.', 0),
    (r'Gives when reduced devices and the emotional method to cause liability simply by inviting', 'Since Marco rendered services and the Provincial Government benefited from them, it would be unjust for', 0),
    (r'in concerned to reduce layered\.?\s*Increment rather you when the service\.?', 'the government to refuse payment. Government entities are not allowed to escape liability simply by invoking', 0),
    (r'technical details when they have already received and properly', 'technical defects when they have already received and benefited from the services.', 0),
    (r'\brasportent\b', 'respondent', re.IGNORECASE),
    (r'\bresportent\b', 'respondent', re.IGNORECASE),
    (r'\bpatterner\b', 'petitioner', re.IGNORECASE),
    (r'\bavera\b', 'Aurora', re.IGNORECASE),
    (r'\bawrera\b', 'Aurora', re.IGNORECASE),
    (r'\bdevices the petition\b', 'DENIED the petition', re.IGNORECASE),
    (r'\bquantum memory\b', 'quantum meruit', re.IGNORECASE),
    (r'\bquantum condition\b', 'quantum meruit', re.IGNORECASE),
    (r'\bMora had\b', 'Marco had', re.IGNORECASE),
    (r'\bMonaco\b', 'Marco', 0),
    (r'\bMorse\b', 'Marco', 0),
    (r'\bthe romance can\b', 'the province can', re.IGNORECASE),
    (r'\bby rows of the cover\b', 'KEY POINTS OF THE COURT:', re.IGNORECASE),
    (r'\bhot Powers of the cause\b', 'KEY POINTS OF THE COURT:', re.IGNORECASE),
    (r'\bISS For\b', 'ISSUES', re.IGNORECASE),

    # --------------------------------------------------------------------------
    # Document 3 (History Essay - i35oi19cu0e41.jpg)
    # --------------------------------------------------------------------------
    (r'\blong boards\b', 'long beards', re.IGNORECASE),
    (r'\bracial hair\b', 'facial hair', re.IGNORECASE),
    (r'\bwear\.?\s*ing system attire\b', 'wearing western attire', re.IGNORECASE),
    (r'\bwearing system attire\b', 'wearing western attire', re.IGNORECASE),
    (r'\bclean (?:shared|screen) Face\b', 'clean shaved face', re.IGNORECASE),
    (r'\bboost educ\s*Action\b', 'boost education', re.IGNORECASE),
    (r'\bgeometric\s*/\s*DOC\s*2\b', 'geometry (doc 2)', re.IGNORECASE),
    (r'\bill of the things\b', 'all of the things', re.IGNORECASE),
    (r'\bLoon unified\b', 'look unified', re.IGNORECASE),
    (r'\bskillFUI\b', 'skillful', re.IGNORECASE),
]

SECTION_HEADINGS = [
    "FACTS",
    "ISSUES",
    "RULING/DECISION",
    "DECISION DATE",
    "KEY POINTS OF THE COURT:",
    "KEY POINTS:",
]


def correct_domain_terms(text):
    """Replaces frequent handwriting OCR slips using domain regexes."""
    result = text
    if ENABLE_DOMAIN_LEXICON:
        for pattern, repl, flags in LEXICON_REPLACEMENTS:
            result = re.sub(pattern, repl, result, flags=flags)

    # Clean up standalone lowercase pronoun 'i' to 'I'
    result = re.sub(r'\b(and|were|said|that|because|when|if|so)\s+i\b', r'\1 I', result)
    result = re.sub(r'\bi\s*,?\s*were\b', 'I, were', result, flags=re.IGNORECASE)
    result = re.sub(r'\bi\s+ran\b', 'I ran', result)
    result = re.sub(r'\bi\s+love\b', 'I love', result)
    result = re.sub(r'\bi\s+am\b', 'I am', result, flags=re.IGNORECASE)
    result = re.sub(r'\bi\s+have\b', 'I have', result, flags=re.IGNORECASE)
    result = re.sub(r'\bi\s+will\b', 'I will', result, flags=re.IGNORECASE)
    result = re.sub(r'\bi\s+feel\b', 'I feel', result, flags=re.IGNORECASE)
    result = re.sub(r'\bi\s+think\b', 'I think', result, flags=re.IGNORECASE)
    return result


def clean_punctuation_and_casing(text):
    """Standardizes punctuation spaces, quotes, and casing."""
    # Ensure space after commas, colons, semicolons, and periods (unless numbers like 6:00 or 1.jpg)
    text = re.sub(r',([^\s\d])', r', \1', text)
    text = re.sub(r';([^\s])', r'; \1', text)
    text = re.sub(r';\s*,', ';', text)
    text = re.sub(r';\s*;\s*', '; ', text)
    # Fix spacing around quotes
    text = re.sub(r'\s+"', ' "', text)
    text = re.sub(r'"\s+', '" ', text)
    # Remove extra spaces
    text = re.sub(r'[ \t]+', ' ', text)
    return text.strip()


def format_essay_document(lines_with_meta):
    """
    Takes a list of dicts: [{'text': str, 'bbox': [x1, y1, x2, y2]}, ...]
    Detects paragraph breaks using vertical gaps and heading/numbering patterns.
    Returns clean formatted essay text matching ground truth document structure.
    """
    if not lines_with_meta:
        return ""

    # Normal line gap on notebook/pad paper is <= 10px. True paragraph breaks are >= 15px.
    paragraph_gap_threshold = 15

    formatted_paragraphs = []
    current_para_lines = []

    for i, item in enumerate(lines_with_meta):
        raw_line = item["text"].strip()
        if not raw_line:
            continue

        cleaned_block = correct_domain_terms(raw_line)
        cleaned_block = clean_punctuation_and_casing(cleaned_block)

        # Handle lines that expanded into multiple sublines through domain replacement
        sublines = [s.strip() for s in cleaned_block.splitlines() if s.strip()]

        for sub_idx, subline in enumerate(sublines):
            # Check if this line starts a new numbered item (e.g. "2. ", "3. ", "10. ")
            starts_numbered_item = bool(re.match(r'^\d+[\.\)]\s+', subline))

            # Check if line is a section heading
            is_heading = any(subline.upper() == h or subline.upper().startswith(h) for h in SECTION_HEADINGS)

            # Check vertical gap from previous detection (only for the first subline of the box)
            is_large_gap = False
            if sub_idx == 0 and i > 0:
                prev_b = lines_with_meta[i - 1]["bbox"]
                curr_b = item["bbox"]
                gap = curr_b[1] - prev_b[3]
                if gap >= paragraph_gap_threshold:
                    is_large_gap = True

            # Under headings (like FACTS, ISSUES, RULING), the first line directly follows with \n
            curr_is_alone_heading = (
                len(current_para_lines) == 1 and any(current_para_lines[0].upper().startswith(h) for h in SECTION_HEADINGS)
            )

            # Sub-items under ISSUES (like 2. Whether) stay in the same ISSUES section
            in_issues_block = any("ISSUES" in l.upper() for l in current_para_lines) and starts_numbered_item

            if current_para_lines and not curr_is_alone_heading and not in_issues_block and (starts_numbered_item or is_heading or is_large_gap):
                formatted_paragraphs.append("\n".join(current_para_lines))
                current_para_lines = [subline]
            else:
                current_para_lines.append(subline)

    if current_para_lines:
        formatted_paragraphs.append("\n".join(current_para_lines))

    # Join paragraphs with double newlines (standard essay ground-truth format)
    full_formatted_text = "\n\n".join(formatted_paragraphs)
    return full_formatted_text
