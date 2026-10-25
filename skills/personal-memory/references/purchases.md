# Purchase ledger reference

Record purchases the owner says they actually made. A shopping wish, recommendation request, returned item or hypothetical budget is not automatically a new purchase. Preserve seller, item, quantity, warranty and payment qualifications when supplied. Never invent any of them.

Store amount as a decimal string with at most two decimal places; use ISO currency codes only when stated or unambiguously expressed (TL → TRY, € → EUR, $ without country context requires clarification). Keep amount and currency both null when absent. Never convert currencies without an explicitly sourced rate and date. Do not turn an installment, deposit, loan, refund or outstanding balance into a discounted total. Keep these qualifiers in body and summary. Arithmetic summaries must identify their coverage and exclude unknown amounts rather than treating them as zero.

The server records creation time automatically. occurredAt represents an explicitly known purchase timestamp, not when it was mentioned. If only a day is known, set occurredOn to the resolved ISO calendar day, retain it in body, and leave occurredAt:null. Do not fabricate a time of day merely to fill a timestamp. If neither is known, leave both null. Search a few distinguishing product/vendor keywords before answering a historical question. Report record and occurrence dates separately. Updating a price or correcting a purchase requires a current record read and optimistic version.

Examples: "Dün 1200 TL peşinat ödedim, toplam 5000 TL" must not be summarized as "1200 TL purchase total". "Kulaklık almayı düşünüyorum" is discussion, not a purchase. "Az önce kulaklık aldım, 850 TL" is an owner-stated purchase; save and disclose the exact record after server success.
