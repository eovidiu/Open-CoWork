import { app } from 'electron'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'
import { existsSync, copyFileSync } from 'fs'
import { chmod } from 'fs/promises'

let prisma: PrismaClient | null = null

// Pre-installed skills for document handling
const PRE_INSTALLED_SKILLS = [
  {
    name: 'pdf',
    description:
      'Comprehensive PDF manipulation toolkit for extracting text and tables, creating new PDFs, merging/splitting documents, and handling forms. Use when processing, generating, or analyzing PDF documents.',
    sourceUrl: 'https://skillregistry.io/skills/pdf',
    content: `---
name: pdf
description: Comprehensive PDF manipulation toolkit for extracting text and tables, creating new PDFs, merging/splitting documents, and handling forms. Use when processing, generating, or analyzing PDF documents.
homepage: https://github.com/anthropics/skills
---

# PDF Processing

Essential PDF processing operations using Python libraries and command-line tools.

## Python Libraries

### pypdf

Basic reading and writing operations:

\`\`\`python
from pypdf import PdfReader, PdfWriter

# Read PDF
reader = PdfReader("input.pdf")
for page in reader.pages:
    text = page.extract_text()

# Write/merge PDFs
writer = PdfWriter()
writer.add_page(page)
writer.write("output.pdf")
\`\`\`

### pdfplumber

Advanced text and table extraction:

\`\`\`python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        text = page.extract_text()
        tables = page.extract_tables()
\`\`\`

### reportlab

Create new PDFs from scratch:

\`\`\`python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("new.pdf", pagesize=letter)
c.drawString(100, 750, "Hello World")
c.save()
\`\`\`

## Command-Line Tools

### pdftotext

Extract text from PDFs:
\`\`\`bash
pdftotext input.pdf output.txt
\`\`\`

### qpdf

Manipulate PDF structure:
\`\`\`bash
qpdf --split-pages input.pdf output-%d.pdf
\`\`\`

### pdftk

Merge, split, rotate:
\`\`\`bash
pdftk file1.pdf file2.pdf cat output merged.pdf
\`\`\`

## Common Tasks

### OCR for Scanned Documents

Use pytesseract with pdf2image for scanned PDFs.

### Watermarking

Overlay text or images on existing PDFs.

### Image Extraction

Extract embedded images from PDF pages.

### Password Protection

Add or remove PDF encryption.

## Quick Reference

| Task | Tool |
|------|------|
| Extract text | pdfplumber, pdftotext |
| Extract tables | pdfplumber |
| Merge PDFs | pypdf, pdftk |
| Split PDFs | qpdf, pdftk |
| Create PDFs | reportlab |
| Rotate pages | pypdf, pdftk |
| Fill forms | pypdf |
| OCR | pytesseract |`
  },
  {
    name: 'xlsx',
    description:
      'Spreadsheet creation, editing, and analysis with formulas and visualization. Use when working with Excel files (.xlsx) for financial models, data analysis, reports, or any spreadsheet tasks requiring formulas, formatting, and data manipulation.',
    sourceUrl: 'https://skillregistry.io/skills/xlsx',
    content: `---
name: xlsx
description: Spreadsheet creation, editing, and analysis with formulas and visualization. Use when working with Excel files (.xlsx) for financial models, data analysis, reports, or any spreadsheet tasks requiring formulas, formatting, and data manipulation.
homepage: https://github.com/anthropics/skills
---

# XLSX Processing

Comprehensive toolkit for creating, editing, and analyzing Excel spreadsheets.

## Core Standards

- **Zero formula errors** in all Excel deliverables
- Industry-standard color coding for financial models

### Color Coding Convention

- Blue text (RGB: 0,0,255) - Inputs/assumptions
- Black text - Formulas and calculations
- Green text - Internal links
- Red text - External references

## Critical Workflow Rule

**Use formulas, never hardcoded values.**

Always use Excel formulas instead of calculating values in Python and hardcoding them. This maintains spreadsheet dynamism.

\`\`\`python
# CORRECT - Use formula
cell.value = "=SUM(B2:B9)"

# INCORRECT - Hardcoded calculation
cell.value = calculated_sum
\`\`\`

## Technical Requirements

### Recalculation

After creating/editing files with formulas, recalculate to verify:
- Values compute correctly
- No formula errors exist

### Number Formatting

- Years as text: "2024"
- Currency: $#,##0
- Zeros displayed as: "-"
- Percentages: 0.0%

### Documentation

Hardcoded values require source citations:
- Date of data
- Reference name
- URL when available

## Library Selection

- **openpyxl** - For formulas and formatting
- **pandas** - For data analysis and manipulation

## Formula Best Practices

1. Test 2-3 sample references before broader application
2. Use named ranges for clarity
3. Document complex formulas with comments
4. Verify formula integrity with checklist

## Template Preservation

Preserve existing templates over imposing standardized formatting. Respect the structure users have created.`
  },
  {
    name: 'docx',
    description:
      'Document creation, editing, and analysis with support for tracked changes, comments, formatting preservation, and text extraction. Use when working with Word documents (.docx) for creating, modifying, reviewing, or analyzing professional documents.',
    sourceUrl: 'https://skillregistry.io/skills/docx',
    content: `---
name: docx
description: Document creation, editing, and analysis with support for tracked changes, comments, formatting preservation, and text extraction. Use when working with Word documents (.docx) for creating, modifying, reviewing, or analyzing professional documents.
homepage: https://github.com/anthropics/skills
---

# DOCX Processing

Comprehensive toolkit for Word document manipulation.

## Core Capabilities

- Document creation from scratch
- Editing existing documents
- Tracked changes support
- Comments and annotations
- Formatting preservation
- Text extraction and analysis

## Primary Workflows

### Reading/Analysis

Use text extraction for content analysis. Access raw XML for:
- Comments
- Complex formatting
- Document metadata

### Creating Documents

Use docx-js library with JavaScript/TypeScript to build new Word documents from scratch.

### Editing Existing Documents

Python-based Document library handles OOXML manipulation with:
- High-level methods for common operations
- Direct DOM access for complex changes

### Document Review (Redlining)

For tracked changes:
1. Plan changes in markdown first
2. Implement systematic OOXML edits
3. Preserve revision history

## Key Implementation Principles

### Minimal, Precise Edits

Only mark text that actually changes. Don't replace entire sentences when modifying a word.

### Preserve Unchanged Content

Reuse original XML elements with their RSID values for unchanged portions.

### Batching Strategy

Group 3-10 related changes per batch:
- Enables manageable debugging
- Maintains efficiency
- Reduces error surface

## Technical Operations

\`\`\`
# Unpack document
python ooxml/scripts/unpack.py document.docx

# Modify XML files...

# Repack document
python ooxml/scripts/pack.py document.docx
\`\`\`

## Visual Analysis

Convert documents to PDF then JPEG for visual inspection when needed.

## Best Practices

- Always work on copies, not originals
- Validate document structure after edits
- Test tracked changes display in Word
- Preserve styles and formatting`
  },
  {
    name: 'pptx',
    description:
      'Presentation creation and editing for PowerPoint files (.pptx). Use when creating new presentations, editing existing slides, or working with templates. Supports reading, analyzing, creating from scratch, and template-based workflows.',
    sourceUrl: 'https://skillregistry.io/skills/pptx',
    content: `---
name: pptx
description: Presentation creation and editing for PowerPoint files (.pptx). Use when creating new presentations, editing existing slides, or working with templates. Supports reading, analyzing, creating from scratch, and template-based workflows.
homepage: https://github.com/anthropics/skills
---

# PPTX Processing

Comprehensive guidance for working with PowerPoint presentations.

## Core Functions

### Reading & Analysis

- Extract text for content analysis
- Access raw XML for detailed elements
- Read comments and speaker notes
- Analyze design properties

### Creating Presentations

Two primary workflows:

**From scratch:**
1. Convert HTML slides with custom design
2. Use appropriate colors and fonts (web-safe only)
3. Ensure readability
4. Validate layouts through thumbnail grids

**From templates:**
1. Duplicate template slides
2. Replace content via inventory and replacement
3. Preserve original formatting

### Editing Existing Presentations

1. Unpack PPTX files
2. Modify XML content
3. Validate changes
4. Repack using OOXML format

## Key Workflows

### New Presentation Creation

1. State design approach first
2. Select appropriate colors and fonts
3. Ensure text readability
4. Validate layouts visually

### Template-Based Presentations

1. Extract template inventory
2. Analyze layouts visually
3. Create content outlines
4. Rearrange slides as needed
5. Apply text replacements
6. Preserve formatting

### Validation

Always validate after edits before finalizing presentations.

## Best Practices

- Match layout structures to actual content
- Don't force content into mismatched templates
- Use web-safe fonts only
- Test readability at presentation size
- Preserve template styling

## Common Operations

- Slide duplication and rearrangement
- Text replacement while preserving format
- Adding images and shapes
- Modifying speaker notes
- Extracting content for analysis`
  }
]

export async function initDatabase(): Promise<PrismaClient> {
  if (prisma) return prisma

  // In development, use the local dev.db
  // In production, use the user data directory
  const isDev = !app.isPackaged
  let dbPath: string

  if (isDev) {
    // Use the project's dev.db for development
    dbPath = join(process.cwd(), 'prisma', 'dev.db')
  } else {
    // Use user data directory for production
    dbPath = join(app.getPath('userData'), 'open-cowork.db')

    // Copy the template database if it doesn't exist
    const templateDbPath = join(process.resourcesPath, 'prisma', 'dev.db')
    if (!existsSync(dbPath) && existsSync(templateDbPath)) {
      copyFileSync(templateDbPath, dbPath)
    }
  }

  // Set restrictive file permissions on the database (user read/write only)
  // Note: For stronger protection, consider SQLCipher for encryption at rest
  if (existsSync(dbPath)) {
    await chmod(dbPath, 0o600).catch(() => {
      // Ignore chmod errors on platforms that don't support it (e.g., Windows)
    })
  }

  // Create Prisma client
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: `file:${dbPath}`
      }
    }
  })

  // Connect to database
  await prisma.$connect()

  // Ensure default settings exist
  try {
    await prisma.settings.upsert({
      where: { id: 'default' },
      update: {},
      create: {
        id: 'default',
        theme: 'system',
        defaultModel: 'google/gemini-3-flash-preview',
        onboardingComplete: false
      }
    })
  } catch (error) {
    console.error('Failed to initialize settings:', error)
  }

  // Install pre-installed skills if they don't exist
  try {
    for (const skill of PRE_INSTALLED_SKILLS) {
      const existing = await prisma.skill.findFirst({
        where: { name: skill.name }
      })
      if (!existing) {
        await prisma.skill.create({
          data: {
            name: skill.name,
            description: skill.description,
            content: skill.content,
            sourceUrl: skill.sourceUrl,
            enabled: true
          }
        })
        console.log(`[Database] Installed pre-installed skill: ${skill.name}`)
      }
    }
  } catch (error) {
    console.error('Failed to install pre-installed skills:', error)
  }

  return prisma
}

export function getDatabase(): PrismaClient {
  if (!prisma) {
    throw new Error('Database not initialized. Call initDatabase first.')
  }
  return prisma
}

export async function closeDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect()
    prisma = null
  }
}
