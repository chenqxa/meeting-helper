// Intelligent text segmentation
export interface TextSegment {
  id: string;
  content: string;
  speaker?: string;
  timestamp?: string;
  topic?: string;
  type: 'discussion' | 'decision' | 'action' | 'summary';
  confidence: number;
}

export interface SegmentationResult {
  segments: TextSegment[];
  metadata: {
    totalSegments: number;
    speakers: string[];
    topics: string[];
    estimatedDuration: string;
  };
}

export class TextSegmenter {
  // Segment text based on speakers, topics, and content type
  static async segmentText(cleanedText: string): Promise<SegmentationResult> {
    const segments: TextSegment[] = [];
    const lines = cleanedText.split('\n').filter(line => line.trim());
    
    let currentSpeaker: string | undefined;
    let currentTopic: string | undefined;
    let segmentId = 1;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // Extract speaker
      const speakerMatch = trimmedLine.match(/^(\w+):\s*(.*)/);
      if (speakerMatch) {
        currentSpeaker = speakerMatch[1];
        const content = speakerMatch[2];

        // Determine segment type
        const segmentType = this.determineSegmentType(content);
        const topic = this.extractTopic(content);

        segments.push({
          id: `segment-${segmentId++}`,
          content: content,
          speaker: currentSpeaker,
          topic: topic || currentTopic,
          type: segmentType,
          confidence: this.calculateConfidence(content, segmentType)
        });

        if (topic) currentTopic = topic;
      } else {
        // Continue with current speaker
        segments.push({
          id: `segment-${segmentId++}`,
          content: trimmedLine,
          speaker: currentSpeaker,
          topic: currentTopic,
          type: this.determineSegmentType(trimmedLine),
          confidence: this.calculateConfidence(trimmedLine, 'discussion')
        });
      }
    }

    const metadata = this.extractSegmentMetadata(segments);

    return { segments, metadata };
  }

  // Determine the type of segment
  private static determineSegmentType(content: string): TextSegment['type'] {
    const lowerContent = content.toLowerCase();

    // Decision indicators
    if (this.matchesPatterns(lowerContent, [
      'decide', 'decision', 'agreed', 'concluded', 'determined',
      'final', 'confirm', 'approve', 'reject', 'accept'
    ])) {
      return 'decision';
    }

    // Action indicators
    if (this.matchesPatterns(lowerContent, [
      'will', 'going to', 'need to', 'should', 'must', 'action',
      'task', 'assign', 'responsible', 'deadline', 'complete'
    ])) {
      return 'action';
    }

    // Summary indicators
    if (this.matchesPatterns(lowerContent, [
      'summary', 'conclusion', 'recap', 'overview', 'summary of',
      'in conclusion', 'to summarize', 'key points'
    ])) {
      return 'summary';
    }

    return 'discussion';
  }

  // Check if content matches any patterns
  private static matchesPatterns(content: string, patterns: string[]): boolean {
    return patterns.some(pattern => content.includes(pattern));
  }

  // Extract topic from content
  private static extractTopic(content: string): string | undefined {
    const topicKeywords = [
      'budget', 'timeline', 'project', 'team', 'client', 'deadline',
      'requirements', 'design', 'development', 'testing', 'deployment',
      'marketing', 'sales', 'strategy', 'planning', 'review'
    ];

    const lowerContent = content.toLowerCase();
    for (const keyword of topicKeywords) {
      if (lowerContent.includes(keyword)) {
        return keyword;
      }
    }

    return undefined;
  }

  // Calculate confidence score for segment classification
  private static calculateConfidence(content: string, type: TextSegment['type']): number {
    const length = content.length;
    const wordCount = content.split(/\s+/).length;

    // Base confidence on content length and type indicators
    let confidence = 0.5;

    if (wordCount > 10) confidence += 0.2;
    if (wordCount > 20) confidence += 0.1;

    // Type-specific confidence adjustments
    if (type === 'decision' && content.toLowerCase().includes('decide')) {
      confidence += 0.2;
    }
    if (type === 'action' && content.toLowerCase().includes('will')) {
      confidence += 0.2;
    }

    return Math.min(confidence, 1.0);
  }

  // Extract metadata from segments
  private static extractSegmentMetadata(segments: TextSegment[]): SegmentationResult['metadata'] {
    const speakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))];
    const topics = [...new Set(segments.map(s => s.topic).filter(Boolean))];
    
    // Estimate duration (rough calculation: 2 minutes per segment)
    const estimatedMinutes = segments.length * 2;
    const hours = Math.floor(estimatedMinutes / 60);
    const minutes = estimatedMinutes % 60;
    const estimatedDuration = hours > 0 
      ? `${hours}h ${minutes}m` 
      : `${minutes}m`;

    return {
      totalSegments: segments.length,
      speakers: speakers as string[],
      topics: topics as string[],
      estimatedDuration
    };
  }
}
