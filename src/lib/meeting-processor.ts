// Main meeting processing orchestrator
import { TextProcessor } from './text-processor';
import { TextSegmenter, SegmentationResult } from './text-segmenter';
import { SummaryGenerator, StructuredSummary } from './summary-generator';
import { ActionExtractor, ExtractionResult } from './action-extractor';

export interface ProcessedMeeting {
  id: string;
  originalText: string;
  cleanedText: string;
  segments: SegmentationResult;
  summary: StructuredSummary;
  actionItems: ExtractionResult;
  processingTime: number;
  metadata: {
    totalWords: number;
    estimatedDuration: string;
    participantCount: number;
    topicCount: number;
    actionItemCount: number;
    confidence: number;
  };
}

export interface ProcessingOptions {
  enableCleaning?: boolean;
  enableSegmentation?: boolean;
  enableSummary?: boolean;
  enableActionExtraction?: boolean;
  maxTextLength?: number;
}

export class MeetingProcessor {
  // Main processing pipeline
  static async processMeeting(
    originalText: string,
    meetingTitle: string,
    meetingDate: string,
    options: ProcessingOptions = {},
    participants?: string[]
  ): Promise<ProcessedMeeting> {
    const startTime = Date.now();

    // Default options
    const opts = {
      enableCleaning: true,
      enableSegmentation: true,
      enableSummary: true,
      enableActionExtraction: true,
      maxTextLength: 10000,
      ...options
    };

    // Step 1: Text cleaning
    let cleanedText = originalText;
    let textMetadata: { wordCount: number; speakerCount: number; topics: string[]; duration?: string } = { wordCount: 0, speakerCount: 0, topics: [] };
    
    if (opts.enableCleaning) {
      const cleaned = TextProcessor.cleanText(originalText);
      cleanedText = cleaned.cleanedText;
      textMetadata = cleaned.metadata;
    }

    // Truncate text if too long
    if (cleanedText.length > opts.maxTextLength) {
      cleanedText = cleanedText.substring(0, opts.maxTextLength) + '...';
    }

    // Step 2: Text segmentation
    let segments: SegmentationResult = { segments: [], metadata: { totalSegments: 0, speakers: [], topics: [], estimatedDuration: '0m' } };
    
    if (opts.enableSegmentation) {
      segments = await TextSegmenter.segmentText(cleanedText);
    }

    // Step 3 & 4: Summary + Action Items in PARALLEL (saves ~50% time)
    let summary: StructuredSummary = {
      title: meetingTitle,
      overview: '',
      keyTopics: [],
      decisions: [],
      risks: [],
      nextSteps: [],
      participants: [],
      meetingDate,
      estimatedDuration: '0m'
    };
    let actionItems: ExtractionResult = { actionItems: [], metadata: { totalItems: 0, byPriority: {}, byAssignee: {}, byCategory: {}, confidence: 0 } };

    const tasks: Promise<void>[] = [];
    if (opts.enableSummary) {
      tasks.push(
        SummaryGenerator.generateSummary(segments.segments, meetingTitle, meetingDate)
          .then(r => { summary = r; })
          .catch(e => { console.error('[MeetingProcessor] Summary generation failed:', e); })
      );
    }
    if (opts.enableActionExtraction) {
      tasks.push(
        ActionExtractor.extractActionItems(segments.segments, participants)
          .then(r => { actionItems = r; })
          .catch(e => { console.error('[MeetingProcessor] Action extraction failed:', e); })
      );
    }
    await Promise.all(tasks);

    const processingTime = Date.now() - startTime;

    // Combine metadata
    const metadata = {
      totalWords: textMetadata.wordCount,
      estimatedDuration: segments.metadata.estimatedDuration,
      participantCount: Math.max(textMetadata.speakerCount, summary.participants.length),
      topicCount: Math.max(textMetadata.topics.length, segments.metadata.topics.length, summary.keyTopics.length),
      actionItemCount: actionItems.actionItems.length,
      confidence: this.calculateOverallConfidence(segments, summary, actionItems)
    };

    return {
      id: `meeting-${Date.now()}`,
      originalText,
      cleanedText,
      segments,
      summary,
      actionItems,
      processingTime,
      metadata
    };
  }

  // Calculate overall confidence score
  private static calculateOverallConfidence(
    segments: SegmentationResult,
    summary: StructuredSummary,
    actionItems: ExtractionResult
  ): number {
    const segmentConfidence = segments.segments.length > 0 
      ? segments.segments.reduce((sum, s) => sum + s.confidence, 0) / segments.segments.length 
      : 0.5;

    const summaryConfidence = 0.8; // AI-generated summary confidence
    const actionConfidence = actionItems.metadata.confidence;

    // Weighted average
    return (segmentConfidence * 0.3 + summaryConfidence * 0.4 + actionConfidence * 0.3);
  }

  // Validate processing results
  static validateResults(results: ProcessedMeeting): { isValid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Check if text was processed
    if (!results.cleanedText || results.cleanedText.length === 0) {
      warnings.push('No cleaned text available');
    }

    // Check segmentation results
    if (results.segments.segments.length === 0) {
      warnings.push('No segments were created');
    }

    // Check summary quality
    if (!results.summary.overview || results.summary.overview.length < 50) {
      warnings.push('Summary overview is too short');
    }

    // Check action items
    if (results.actionItems.actionItems.length === 0) {
      warnings.push('No action items were extracted');
    }

    // Check confidence
    if (results.metadata.confidence < 0.5) {
      warnings.push('Low overall confidence score');
    }

    return {
      isValid: warnings.length === 0,
      warnings
    };
  }

  // Generate processing report
  static generateReport(results: ProcessedMeeting): string {
    const report = `
# Meeting Processing Report

## Basic Information
- **Meeting ID**: ${results.id}
- **Processing Time**: ${results.processingTime}ms
- **Overall Confidence**: ${(results.metadata.confidence * 100).toFixed(1)}%

## Content Analysis
- **Original Text Length**: ${results.originalText.length} characters
- **Cleaned Text Length**: ${results.cleanedText.length} characters
- **Total Words**: ${results.metadata.totalWords}
- **Estimated Duration**: ${results.metadata.estimatedDuration}

## Segmentation Results
- **Total Segments**: ${results.segments.metadata.totalSegments}
- **Speakers Identified**: ${results.segments.metadata.speakers.length}
- **Topics Found**: ${results.segments.metadata.topics.length}

## Summary Generation
- **Key Topics**: ${results.summary.keyTopics.length}
- **Decisions Made**: ${results.summary.decisions.length}
- **Risks Identified**: ${results.summary.risks.length}
- **Next Steps**: ${results.summary.nextSteps.length}

## Action Items
- **Total Action Items**: ${results.actionItems.actionItems.length}
- **High Priority**: ${results.actionItems.metadata.byPriority.high || 0}
- **Medium Priority**: ${results.actionItems.metadata.byPriority.medium || 0}
- **Low Priority**: ${results.actionItems.metadata.byPriority.low || 0}

## Quality Metrics
- **Extraction Confidence**: ${(results.actionItems.metadata.confidence * 100).toFixed(1)}%
- **Validation Status**: ${this.validateResults(results).isValid ? 'PASSED' : 'WARNINGS'}

${this.validateResults(results).warnings.length > 0 ? `
## Warnings
${this.validateResults(results).warnings.map(w => `- ${w}`).join('\n')}
` : ''}
    `.trim();

    return report;
  }
}
