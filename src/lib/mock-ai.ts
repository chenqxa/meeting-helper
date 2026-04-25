// Mock AI generation for demo purposes
export interface MockSummary {
  topics: string[];
  keyDecisions: string[];
  risks: string[];
  nextSteps: string[];
  rawText: string;
}

export interface MockActionItem {
  description: string;
  assignee: string | null;
  dueDate: string | null;
  priority: 'high' | 'medium' | 'low';
  confidence: 'high' | 'medium' | 'low';
  sourceText: string;
}

export function generateMockSummary(content: string): MockSummary {
  const lines = content.split('\n').filter(line => line.trim());
  const firstLine = lines[0] || '';
  
  return {
    topics: [
      'Review project progress',
      'Discuss timeline adjustments',
      'Address resource constraints',
      'Plan next milestone'
    ].slice(0, Math.min(4, Math.max(2, lines.length / 10))),
    keyDecisions: [
      'Extend project deadline by 2 weeks',
      'Allocate additional resources to critical path',
      'Implement weekly progress reviews'
    ].slice(0, Math.min(3, Math.max(1, lines.length / 15))),
    risks: [
      'Potential budget overrun due to timeline extension',
      'Team availability during upcoming holidays',
      'Technical dependencies on external teams'
    ].slice(0, Math.min(3, Math.max(1, lines.length / 20))),
    nextSteps: [
      'Update project schedule with new timeline',
      'Secure resource approvals from management',
      'Schedule kickoff meeting for extended phase',
      'Communicate changes to all stakeholders'
    ].slice(0, Math.min(4, Math.max(2, lines.length / 12))),
    rawText: content.substring(0, 200) + '...'
  };
}

export function generateMockActionItems(content: string): MockActionItem[] {
  const lines = content.split('\n').filter(line => line.trim());
  const items: MockActionItem[] = [];
  
  // Generate action items based on content length
  const itemCount = Math.min(5, Math.max(2, lines.length / 8));
  
  for (let i = 0; i < itemCount; i++) {
    const priorities: ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];
    const confidences: ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];
    
    items.push({
      description: `Action item ${i + 1}: Complete task related to ${lines[i % lines.length]?.substring(0, 50) || 'project requirements'}`,
      assignee: i % 2 === 0 ? 'Team Member' + (i + 1) : null,
      dueDate: i % 3 === 0 ? new Date(Date.now() + (i + 1) * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : null,
      priority: priorities[i % 3],
      confidence: confidences[(i + 1) % 3],
      sourceText: lines[i % lines.length]?.substring(0, 100) || ''
    });
  }
  
  return items;
}
