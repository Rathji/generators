// ============================================================================
//  DOCUMENT TEMPLATES  (T6 — Template Loader)
//
//  Pre-defined business document structures that the Documents app can load
//  into the editor in one click. Each template is authored directly in the
//  RichText Markdown subset (src/richtext.js): **bold**, _italic_, ~underline~,
//  paragraphs separated by blank lines. No headings or lists yet — the model
//  does not support them, so those characters would render literally. Keeping
//  content in the canonical subset guarantees a byte-exact round-trip:
//  RichText.fromMarkdown(t.content).getMarkdown() === t.content.
// ============================================================================

export const documentTemplates = [
  {
    id: "memo",
    name: "Memo",
    category: "Business",
    description: "Internal office memo with To/From/Date/Subject header.",
    content: `**MEMORANDUM**

**TO:** [Recipient name]
**FROM:** [Your name]
**DATE:** [Date]
**SUBJECT:** [Topic]

This memo is to inform you that [brief summary of the purpose].

**Background**
[Provide context or background information relevant to the topic.]

**Action required**
[Describe what you need the recipient to do, and by when.]

If you have any questions, please contact [your name] at [phone or email].`,
  },
  {
    id: "letter",
    name: "Business letter",
    category: "Business",
    description: "Formal letter with sender block, date, recipient block and signature.",
    content: `**ACME Corporation**
123 Business Avenue
Suite 400
Springfield, IL 62704

[Date]

[Recipient name]
[Recipient title]
[Company name]
[Street address]
[City, State ZIP]

**Re:** [Subject of the letter]

Dear [Recipient],

[Opening paragraph: introduce yourself and state the purpose of the letter.]

[Body paragraph: provide supporting details, context, or evidence.]

[Closing paragraph: summarize your request and offer next steps.]

Sincerely,

[Your name]
[Your title]`,
  },
  {
    id: "agenda",
    name: "Meeting agenda",
    category: "Business",
    description: "Structured agenda with timed items and action-item tracking.",
    content: `**MEETING AGENDA**

**Meeting:** [Meeting name]
**Date:** [Date]
**Time:** [Start time] to [End time]
**Location:** [Room or video link]
**Attendees:** [List of attendees]

**1. Opening & introductions** (5 min)
Review the agenda and welcome participants.

**2. Review of previous minutes** (5 min)
Confirm actions from the last meeting and their status.

**3. Topic one** (15 min)
[Describe the first agenda topic and its goal.]

**4. Topic two** (15 min)
[Describe the second agenda topic and its goal.]

**5. Action items** (10 min)
Assign an owner and a due date to each action item.`,
  },
  {
    id: "report",
    name: "Weekly report",
    category: "Business",
    description: "Status report with accomplishments, blockers and next-week plans.",
    content: `**WEEKLY STATUS REPORT**

**Week ending:** [Date]
**Prepared by:** [Your name]

**Accomplishments this week**
[Summarize what was completed. Use concrete results and numbers where possible.]

**In progress**
[List work currently underway and expected completion dates.]

**Blockers**
[Note anything delaying progress and the help needed to resolve it.]

**Planned for next week**
[Describe priorities and goals for the coming week.]

**Decisions requested**
[Summarize any decisions you need from leadership or stakeholders.]`,
  },
];

/** Find a template by id, or undefined. */
export function findTemplate(id) {
  return documentTemplates.find((t) => t.id === id);
}
