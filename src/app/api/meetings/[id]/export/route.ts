import { NextRequest, NextResponse } from 'next/server';
import { getMeetingById } from '@/storage';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType,
} from 'docx';

const normalizeName = (name?: string | null): string => {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const garbledMap: Record<string, string> = {
    '褰撳墠鐢ㄦ埛': '当前用户',
  };
  return garbledMap[trimmed] ?? trimmed;
};

// ── 生成 Word 文档 ──
async function generateDocx(meeting: any): Promise<Buffer> {
  const m = meeting.minutes;

  // 使用 Step 1 的原始完整 Markdown（包含正文、会议总结、行动项表格）
  const exportMarkdown = m.debug_step1a_markdown || m.markdownBody || '';
  const originalMarkdownBody = m.markdownBody;
  m.markdownBody = exportMarkdown;

  const children: Paragraph[] = [];

  // ── 标题 ──
  children.push(new Paragraph({
    text: m.title || meeting.title,
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }));

  // ── 基本信息 ──
  const organizerName = normalizeName(meeting.organizer) || '待明确';
  const participants = (meeting.participants || []).map(normalizeName).filter(Boolean);

  const infoLines = [
    `会议主题：${m.meetingTheme || meeting.title}`,
    `会议日期：${m.meetingDate || ''}`,
    `主持人：${organizerName}`,
  ];
  if (participants.length) {
    infoLines.push(`参会人员：${participants.join('、')}`);
  }
  infoLines.push(`导出时间：${new Date().toLocaleString('zh-CN')}`);
  for (const line of infoLines) {
    children.push(new Paragraph({
      children: [new TextRun({ text: line, size: 20, font: '微软雅黑' })],
      spacing: { after: 60 },
    }));
  }
  children.push(new Paragraph({ text: '', spacing: { after: 200 } }));

  // ── 会议概述 ──
  if (m.meetingContent) {
    children.push(new Paragraph({
      text: '会议概述',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 120 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: m.meetingContent, size: 21, font: '微软雅黑' })],
      spacing: { after: 200 },
    }));
  }

  // ── Markdown 正文（新格式）──
  if (m.markdownBody && !m.sections?.length) {
    // 简单处理：将 markdownBody 按行分割为段落
    const lines = m.markdownBody.split('\n').filter((l: string) => l.trim());
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('# ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: t.replace(/^#\s*/, ''), bold: true, size: 24, font: '微软雅黑' })],
          spacing: { before: 240, after: 120 },
        }));
      } else if (t.startsWith('## ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: t.replace(/^##\s*/, ''), bold: true, size: 22, font: '微软雅黑' })],
          spacing: { before: 200, after: 100 },
        }));
      } else if (t.startsWith('### ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: t.replace(/^###\s*/, ''), bold: true, size: 20, font: '微软雅黑' })],
          spacing: { before: 160, after: 80 },
        }));
      } else if (t.startsWith('- ') || t.startsWith('• ')) {
        children.push(new Paragraph({
          children: [new TextRun({ text: t.replace(/^[-•]\s*/, ''), size: 20, font: '微软雅黑' })],
          indent: { left: 480 },
          spacing: { after: 60 },
        }));
      } else if (t) {
        children.push(new Paragraph({
          children: [new TextRun({ text: t, size: 20, font: '微软雅黑' })],
          spacing: { after: 60 },
        }));
      }
    }
  }

  // ── 各章节（旧格式）──
  if (m.sections?.length) {
    for (const section of m.sections) {
      children.push(new Paragraph({
        text: section.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 120 },
      }));

      for (const item of (section.items || [])) {
        // 议题标题
        children.push(new Paragraph({
          children: [new TextRun({
            text: `${item.seq || '●'}. ${item.subtitle}`,
            bold: true, size: 22, font: '微软雅黑',
          })],
          spacing: { before: 160, after: 80 },
        }));

        // 要点
        for (const point of (item.points || [])) {
          const labelPrefix = point.label ? `【${point.label}】` : '';
          children.push(new Paragraph({
            children: [
              ...(labelPrefix ? [new TextRun({ text: labelPrefix, bold: true, size: 20, font: '微软雅黑', color: '2563EB' })] : []),
              new TextRun({ text: point.text, size: 20, font: '微软雅黑' }),
            ],
            indent: { left: 480 },
            spacing: { after: 60 },
          }));

          // 子弹点
          for (const bullet of (point.bullets || [])) {
            children.push(new Paragraph({
              children: [new TextRun({ text: `• ${bullet}`, size: 19, font: '微软雅黑', color: '475569' })],
              indent: { left: 960 },
              spacing: { after: 40 },
            }));
          }
        }
      }
    }
  }

  // ── 行动项表格 ──
  if (m.actionTable?.length) {
    children.push(new Paragraph({
      text: '行动项',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 120 },
    }));

    // 列宽（单位 twip，页面约 9360 twip）：序号6% 任务44% 责任人16% 预期成果34%
    const COL_W = [560, 4120, 1496, 3184]; // 总约9360
    const rowBorder = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' };
    const noBorder = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' };

    const makeCell = (
      text: string,
      colIdx: number,
      opts: { bold?: boolean; color?: string; bg?: string; fontSize?: number } = {}
    ) =>
      new TableCell({
        width: { size: COL_W[colIdx], type: WidthType.DXA },
        children: [new Paragraph({
          children: [new TextRun({
            text,
            bold: opts.bold,
            size: opts.fontSize ?? 20,
            font: '微软雅黑',
            color: opts.color ?? '1E293B',
          })],
          alignment: colIdx === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { before: 60, after: 60 },
        })],
        shading: opts.bg ? { type: ShadingType.SOLID, color: opts.bg } : undefined,
        borders: {
          top: noBorder, left: noBorder, right: noBorder,
          bottom: rowBorder,
        },
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
      });

    const headerRow = new TableRow({
      tableHeader: true,
      height: { value: 480, rule: 'atLeast' as any },
      children: [
        makeCell('序号', 0, { bold: true, color: 'FFFFFF', bg: '3B82F6', fontSize: 20 }),
        makeCell('任务内容', 1, { bold: true, color: 'FFFFFF', bg: '3B82F6', fontSize: 20 }),
        makeCell('责任人', 2, { bold: true, color: 'FFFFFF', bg: '3B82F6', fontSize: 20 }),
        makeCell('预期成果', 3, { bold: true, color: 'FFFFFF', bg: '3B82F6', fontSize: 20 }),
      ],
    });

    const dataRows = m.actionTable.map((row: any, i: number) => {
      const bg = i % 2 === 1 ? 'F8FAFC' : 'FFFFFF';
      return new TableRow({
        children: [
          makeCell(String(row.seq || i + 1), 0, { color: '94A3B8', bg }),
          makeCell(row.task || '', 1, { bg }),
          makeCell(row.owner || '待指定', 2, { color: '2563EB', bg }),
          makeCell(row.goal || '', 3, { color: '64748B', bg }),
        ],
      });
    });

    children.push(new Paragraph({ text: '' })); // spacer
    const table = new Table({
      rows: [headerRow, ...dataRows],
      width: { size: 9360, type: WidthType.DXA },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
        left: { style: BorderStyle.NIL },
        right: { style: BorderStyle.NIL },
      },
    });
    // Table goes into sections directly, add after paragraphs
    // We'll handle this by using document sections

    // Actually, docx library requires tables to be in document sections children alongside paragraphs
    // So we need to return both paragraphs and the table
    // Let's restructure: collect all elements and add table at the right position

    const doc = new Document({
      sections: [{
        children: [
          ...children,
          table,
          new Paragraph({ text: '', spacing: { after: 200 } }),
          // ── 会议总结 ──
          ...(m.conclusion ? [
            new Paragraph({
              text: '会议总结',
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 300, after: 120 },
            }),
            new Paragraph({
              children: [new TextRun({ text: m.conclusion, size: 21, font: '微软雅黑' })],
              spacing: { after: 200 },
            }),
          ] : []),
        ],
      }],
    });

    return Buffer.from(await Packer.toBuffer(doc));
  }

  // 无行动项时：直接结尾
  if (m.conclusion) {
    children.push(new Paragraph({
      text: '会议总结',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 300, after: 120 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: m.conclusion, size: 21, font: '微软雅黑' })],
      spacing: { after: 200 },
    }));
  }

  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ── PDF 辅助：绘制章节标题（带彩色下划线，模拟前端样式）──
const SECTION_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
const LABEL_COLORS: Record<string, string> = {
  '问题': '#ef4444', '决议': '#3b82f6', '共识': '#10b981',
  '进展': '#6366f1', '计划': '#f59e0b', '风险': '#f97316',
};

function drawSectionHeader(doc: any, title: string, colorIdx: number, font: string) {
  const idx = ((colorIdx % SECTION_COLORS.length) + SECTION_COLORS.length) % SECTION_COLORS.length;
  const color = SECTION_COLORS[idx];
  const y = doc.y;
  doc.font(font).fontSize(12).fillColor('#1e293b').text(title, { continued: false });
  const lineY = doc.y + 1;
  doc.moveTo(50, lineY).lineTo(545, lineY).lineWidth(2).strokeColor(color).stroke();
  doc.lineWidth(1);
  doc.moveDown(0.5);
}

// 在固定列坐标绘制表格行，自动换行
function drawTableRow(
  doc: any, font: string,
  cols: { x: number; width: number; text: string; bold?: boolean; color?: string }[],
  rowY: number, fontSize = 9, bg?: string
): number {
  // 计算行高：找最高列
  let maxH = 0;
  for (const col of cols) {
    const h = doc.heightOfString(col.text, { width: col.width - 4, fontSize });
    if (h > maxH) maxH = h;
  }
  const rowH = Math.max(maxH + 8, 18);

  if (bg) {
    doc.rect(50, rowY, 495, rowH).fillColor(bg).fill();
  }
  doc.fillColor('#e2e8f0').rect(50, rowY + rowH - 0.5, 495, 0.5).fill();

  for (const col of cols) {
    doc.font(col.bold ? font : font)
      .fontSize(fontSize)
      .fillColor(col.color || '#374151')
      .text(col.text, col.x + 4, rowY + 4, { width: col.width - 8, lineBreak: true });
  }
  return rowH;
}

// ── 生成 PDF 文档（pdfkit + 中文字体，匹配前端样式）──
async function generatePdf(meeting: any): Promise<Buffer> {
  const PDFDocument = (await import('pdfkit')).default;
  const { existsSync } = await import('fs');
  const m = meeting.minutes;

  // 使用 Step 1 的原始完整 Markdown（包含正文、会议总结、行动项表格）
  const exportMarkdown = m.debug_step1a_markdown || m.markdownBody || '';
  const originalMarkdownBody = m.markdownBody;
  m.markdownBody = exportMarkdown;

  const FONT_CANDIDATES = [
    'C:/Windows/Fonts/simhei.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/truetype/simhei.ttf',
  ];
  const fontPath = FONT_CANDIDATES.find(f => existsSync(f)) || '';

  const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 }, autoFirstPage: true });
  if (fontPath) doc.registerFont('ZH', fontPath);
  const font = fontPath ? 'ZH' : 'Helvetica';

  const chunks: Uint8Array[] = [];
  doc.on('data', (c: Uint8Array) => chunks.push(c));

  const pageW = 495; // usable width (595 - 50*2)

  // ── 文档标题 ──
  doc.font(font).fontSize(18).fillColor('#0f172a')
    .text(m.title || meeting.title, 50, 50, { align: 'center', width: pageW });
  doc.moveDown(0.4);

  // 蓝色装饰线
  const titleLineY = doc.y;
  doc.moveTo(50, titleLineY).lineTo(545, titleLineY).lineWidth(1.5).strokeColor('#3b82f6').stroke();
  doc.lineWidth(1);
  doc.moveDown(0.6);

  // ── 基本信息块 ──
  const infoY = doc.y;
  doc.rect(50, infoY, pageW, 1).fillColor('#f1f5f9').fill(); // top border
  doc.moveDown(0.1);
  doc.font(font).fontSize(9).fillColor('#64748b');
  const organizerName = normalizeName(meeting.organizer) || '待明确';
  const participants = (meeting.participants || []).map(normalizeName).filter(Boolean);

  doc.text(`会议主题：${m.meetingTheme || meeting.title}`, { width: pageW });
  doc.text(`会议日期：${m.meetingDate || ''}  　主持：${organizerName}`, { width: pageW });
  if (participants.length) {
    doc.text(`参会人员：${participants.join('、')}`, { width: pageW });
  }
  doc.moveDown(0.8);

  // ── 会议概述 ──
  if (m.meetingContent) {
    drawSectionHeader(doc, '会议概述', -1, font);
    doc.moveTo(50, doc.y); // reset x
    doc.font(font).fontSize(10).fillColor('#475569')
      .text(m.meetingContent, 50, doc.y, { width: pageW, lineGap: 2 });
    doc.moveDown(1);
  }

  // ── Markdown 正文（新格式）──
  if (m.markdownBody && !m.sections?.length) {
    const lines = m.markdownBody.split('\n').filter((l: string) => l.trim());
    for (const line of lines) {
      const t = line.trim();
      if (doc.y > 700) doc.addPage();
      if (t.startsWith('# ')) {
        doc.font(font).fontSize(16).fillColor('#0f172a').text(t.replace(/^#\s*/, ''), { width: pageW });
        doc.moveDown(0.4);
      } else if (t.startsWith('## ')) {
        doc.font(font).fontSize(14).fillColor('#1e293b').text(t.replace(/^##\s*/, ''), { width: pageW });
        doc.moveDown(0.3);
      } else if (t.startsWith('### ')) {
        doc.font(font).fontSize(12).fillColor('#334155').text(t.replace(/^###\s*/, ''), { width: pageW });
        doc.moveDown(0.2);
      } else if (t.startsWith('- ') || t.startsWith('• ')) {
        doc.font(font).fontSize(10).fillColor('#475569').text(t.replace(/^[-•]\s*/, ''), { width: pageW, indent: 20 });
        doc.moveDown(0.15);
      } else if (t) {
        doc.font(font).fontSize(10).fillColor('#475569').text(t, { width: pageW });
        doc.moveDown(0.15);
      }
    }
  }

  // ── 正文章节（旧格式）──
  const sections: any[] = m.sections || [];
  for (let si = 0; si < sections.length; si++) {
    const section = sections[si];
    // 检查是否需要换页
    if (doc.y > 700) doc.addPage();
    drawSectionHeader(doc, section.title, si, font);

    for (const item of (section.items || [])) {
      if (!item.subtitle && !item.points?.length) continue;
      if (doc.y > 720) doc.addPage();

      // 议题标题
      if (item.subtitle) {
        doc.font(font).fontSize(10.5).fillColor('#1e293b')
          .text(`${item.seq || ''}. ${item.subtitle}`, 60, doc.y, { width: pageW - 10 });
        doc.moveDown(0.2);
      }

      // 要点
      for (const pt of (item.points || [])) {
        const labelColor = LABEL_COLORS[pt.label] || '#6366f1';
        // 布局：竖条x=74, 标签x=78宽32→结束110, 正文x=116
        const BAR_X = 74;
        const CHIP_X = 78;
        const CHIP_W = 32;
        const TEXT_X = 116;           // 芯片结束(110) + 6px 间距
        const TEXT_W = 545 - TEXT_X;  // 429px
        const ptY = doc.y + 1;

        // 竖色条
        doc.rect(BAR_X, ptY + 1, 2, 10).fillColor(labelColor).fillOpacity(0.75).fill().fillOpacity(1);

        // 标签芯片
        doc.roundedRect(CHIP_X, ptY, CHIP_W, 12, 2)
          .fillColor(labelColor).fillOpacity(0.1).fill().fillOpacity(1);
        doc.roundedRect(CHIP_X, ptY, CHIP_W, 12, 2)
          .strokeColor(labelColor).lineWidth(0.5).stroke().lineWidth(1);
        doc.font(font).fontSize(7.5).fillColor(labelColor)
          .text(pt.label, CHIP_X + 1, ptY + 2.5, { width: CHIP_W - 2, align: 'center', lineBreak: false });

        // 正文（从标签右侧开始，换行后也从同一 x 缩进）
        if (pt.text) {
          doc.font(font).fontSize(9.5).fillColor('#374151')
            .text(pt.text, TEXT_X, ptY, { width: TEXT_W, lineGap: 2, indent: 0 });
        } else {
          doc.y = ptY + 14;
        }
        doc.moveDown(0.1);

        // 子弹点（与正文同缩进）
        if (pt.bullets?.length) {
          for (const b of pt.bullets) {
            doc.font(font).fontSize(9).fillColor('#64748b')
              .text(`·  ${b}`, TEXT_X + 4, doc.y, { width: TEXT_W - 8, lineGap: 1.5 });
          }
          doc.moveDown(0.15);
        }
      }
      doc.moveDown(0.4);
    }
    doc.moveDown(0.3);
  }

  // ── 行动项表格 ──
  if (m.actionTable?.length) {
    if (doc.y > 650) doc.addPage();
    drawSectionHeader(doc, `${String.fromCharCode(0x56DB + sections.length - 3)}、会议总结与后续行动`, sections.length, font);

    // 列定义：序号|任务内容|责任人|目标
    const COL = { seq: { x: 50, w: 28 }, task: { x: 78, w: 210 }, owner: { x: 288, w: 70 }, goal: { x: 358, w: 187 } };

    // 表头
    const hY = doc.y;
    doc.rect(50, hY, pageW, 18).fillColor('#f8fafc').fill();
    doc.rect(50, hY + 18, pageW, 0.5).fillColor('#cbd5e1').fill();
    const hCols = [
      { x: COL.seq.x, width: COL.seq.w, text: '序号', bold: true, color: '#64748b' },
      { x: COL.task.x, width: COL.task.w, text: '任务内容', bold: true, color: '#64748b' },
      { x: COL.owner.x, width: COL.owner.w, text: '责任人', bold: true, color: '#64748b' },
      { x: COL.goal.x, width: COL.goal.w, text: '目标', bold: true, color: '#64748b' },
    ];
    drawTableRow(doc, font, hCols, hY, 8.5, '#f8fafc');
    doc.y = hY + 18 + 1;

    // 数据行
    for (let ri = 0; ri < m.actionTable.length; ri++) {
      const row = m.actionTable[ri];
      if (doc.y > 740) doc.addPage();
      const rowY = doc.y;
      const bg = ri % 2 === 0 ? '#ffffff' : '#f8fafc';
      const rCols = [
        { x: COL.seq.x, width: COL.seq.w, text: String(row.seq || ri + 1), color: '#94a3b8' },
        { x: COL.task.x, width: COL.task.w, text: row.task || '', color: '#1e293b' },
        { x: COL.owner.x, width: COL.owner.w, text: row.owner || '', color: '#2563eb' },
        { x: COL.goal.x, width: COL.goal.w, text: row.goal || '', color: '#64748b' },
      ];
      const rh = drawTableRow(doc, font, rCols, rowY, 9, bg);
      doc.y = rowY + rh;
    }
    // 表格底边
    doc.rect(50, doc.y, pageW, 1).fillColor('#e2e8f0').fill();
    doc.moveDown(1);
  }

  // ── 会议总结 ──
  if (m.conclusion) {
    if (doc.y > 700) doc.addPage();
    drawSectionHeader(doc, '会议总结', sections.length + 1, font);
    doc.font(font).fontSize(10).fillColor('#475569')
      .text(m.conclusion, 50, doc.y, { width: pageW, lineGap: 2 });
  }

  doc.end();

  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: meetingId } = await params;
    const { format } = await request.json();

    if (!format || !['word', 'pdf'].includes(format)) {
      return NextResponse.json(
        { success: false, error: '不支持的导出格式，请选择 word 或 pdf' },
        { status: 400 }
      );
    }

    const meeting = await getMeetingById(meetingId);
    if (!meeting) {
      return NextResponse.json(
        { success: false, error: '会议不存在' },
        { status: 404 }
      );
    }

    if (!meeting.minutes) {
      return NextResponse.json(
        { success: false, error: '纪要尚未生成，请先生成纪要' },
        { status: 400 }
      );
    }

    const dateStr = (meeting.meetingDate || new Date().toISOString()).split('T')[0];
    const safeTitle = (meeting.title || '会议纪要').replace(/[\\/:*?"<>|]/g, '_');

    if (format === 'pdf') {
      const pdfBuffer = await generatePdf(meeting);
      const filename = `${safeTitle}_${dateStr}.pdf`;
      const mimeType = 'application/pdf';
      return NextResponse.json({
        success: true,
        data: {
          fileUrl: `data:${mimeType};base64,${pdfBuffer.toString('base64')}`,
          filename,
        },
      });
    }

    // Word format
    const docxBuffer = await generateDocx(meeting);
    const filename = `${safeTitle}_${dateStr}.docx`;
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    return NextResponse.json({
      success: true,
      data: {
        fileUrl: `data:${mimeType};base64,${docxBuffer.toString('base64')}`,
        filename,
      },
    });
  } catch (error) {
    console.error('导出失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '服务器内部错误',
      },
      { status: 500 }
    );
  }
}
