// Text processing utilities
export interface CleanedText {
  originalText: string;
  cleanedText: string;
  metadata: {
    wordCount: number;
    speakerCount: number;
    duration?: string;
    topics: string[];
  };
}

export class TextProcessor {
  // Clean and normalize text
  static cleanText(rawText: string): CleanedText {
    let cleanedText = rawText;

    // Remove excessive whitespace
    cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

    // Remove common noise patterns
    cleanedText = cleanedText.replace(/\[.*?\]/g, ''); // Remove brackets content
    cleanedText = cleanedText.replace(/\(.*?\)/g, ''); // Remove parentheses content
    cleanedText = cleanedText.replace(/^\d+[:\.\-]\s*/gm, ''); // Remove numbering

    // Normalize speaker formats
    cleanedText = this.normalizeSpeakers(cleanedText);

    // Clean timestamps
    cleanedText = this.normalizeTimestamps(cleanedText);

    // Extract metadata
    const metadata = this.extractMetadata(cleanedText);

    return {
      originalText: rawText,
      cleanedText,
      metadata
    };
  }

  // Normalize speaker formats
  private static normalizeSpeakers(text: string): string {
    // Common speaker patterns
    const speakerPatterns = [
      /^(\w+)[:\s]/gm,           // Name: content
      /^(\w+)\s*[~-]\s*/gm,      // Name ~ content
      /^(\w+)[\(][^)]*[)][\s:]/gm, // Name (title): content
      /^(\w+) said[:\s]/gm,      // Name said: content
    ];

    let normalized = text;
    speakerPatterns.forEach(pattern => {
      normalized = normalized.replace(pattern, '$1: ');
    });

    return normalized;
  }

  // Normalize timestamps
  private static normalizeTimestamps(text: string): string {
    // Remove or normalize various timestamp formats
    const timestampPatterns = [
      /\d{1,2}:\d{2}:\d{2}/g,    // HH:MM:SS
      /\d{1,2}:\d{2}/g,          // HH:MM
      /\d{2}:\d{2}\s*[AP]M/gi,   // HH:MM AM/PM
    ];

    let normalized = text;
    timestampPatterns.forEach(pattern => {
      normalized = normalized.replace(pattern, '[TIME]');
    });

    return normalized;
  }

  // Extract metadata from text
  private static extractMetadata(text: string): CleanedText['metadata'] {
    const words = text.split(/\s+/).filter(word => word.length > 0);
    
    // Extract speakers
    const speakers = new Set<string>();
    const speakerMatches = text.match(/^(\w+):/gm);
    if (speakerMatches) {
      speakerMatches.forEach(match => {
        const speaker = match.replace(':', '').trim();
        speakers.add(speaker);
      });
    }

    // Extract potential topics (simple keyword extraction)
    const topicKeywords = ['project', 'meeting', 'report', 'plan', 'deadline', 'budget', 'team', 'client', 'review', 'update'];
    const topics = topicKeywords.filter(keyword => 
      text.toLowerCase().includes(keyword)
    );

    return {
      wordCount: words.length,
      speakerCount: speakers.size,
      topics: [...new Set(topics)]
    };
  }

  // Split text into segments
  static segmentText(text: string, maxSegmentLength: number = 500): string[] {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const segments: string[] = [];
    let currentSegment = '';

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      
      if (currentSegment.length + trimmedSentence.length > maxSegmentLength && currentSegment) {
        segments.push(currentSegment.trim());
        currentSegment = trimmedSentence;
      } else {
        currentSegment += (currentSegment ? '. ' : '') + trimmedSentence;
      }
    }

    if (currentSegment) {
      segments.push(currentSegment.trim());
    }

    return segments;
  }
}
