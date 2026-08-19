import { NextResponse } from 'next/server';
import {
  createMeeting,
  updateMeeting,
  getMeetings,
  createProject,
  getProjects,
  createArtifact,
  getArtifactsByProject,
  createActionItem,
  getActionItemByMeetingAndOriginalId,
  createRequirement,
  getRequirementsByProject,
  createProjectRisk,
  getRisksByProject,
} from '@/storage';
import type { Requirement, ProjectRisk } from '@/storage';
import { resolveActionOwnerIdentity } from '@/lib/action-owner';

const loginIdMap: Record<string, string> = {
  张三: 'zhangsan',
  李四: 'lisi',
  王五: 'wangwu',
  赵六: 'zhaoliu',
  陈七: 'chenqi',
  周八: 'zhouba',
  刘九: 'liuj'.toLowerCase(),
  乔霞: 'chenqiaoxia',
};

const projectSeeds = [
  {
    key: 'smart-lighting-launch',
    name: '智慧办公灯新品上市项目',
    description: '围绕新一代办公照明灯具上市，打通样机定版、样册制作、试产排期与渠道首发。',
    status: 'active' as const,
    phase: '执行中',
    owner: '张三',
    members: ['张三', '李四', '王五', '赵六', '乔霞'],
    targetDate: '2026-07-20',
    artifacts: [
      {
        title: '智慧办公灯上市作战图',
        artifactType: 'document' as const,
        createdBy: '王五',
        parseStatus: 'done' as const,
        sourceRef: 'docs://lighting/launch-plan-v2',
        content: '覆盖新品卖点、渠道节奏、样册物料、首批试产及终端陈列规范的上市作战图。',
      },
    ],
  },
  {
    key: 'ul-certification-switch',
    name: '北美线性灯 UL 认证与量产切换',
    description: '聚焦线性灯产品的 UL 认证整改、BOM 收敛、试产切换与出口资料准备。',
    status: 'at_risk' as const,
    phase: '认证整改',
    owner: '李四',
    members: ['李四', '陈七', '周八', '乔霞'],
    targetDate: '2026-06-28',
    artifacts: [
      {
        title: 'UL 整改问题清单 v1.3',
        artifactType: 'document' as const,
        createdBy: '陈七',
        parseStatus: 'processing' as const,
        sourceRef: 'docs://lighting/ul-gap-list',
        content: '涵盖接线端子温升、外壳阻燃等级、标签丝印、安规资料缺口等整改项。',
      },
    ],
  },
  {
    key: 'hotel-showroom-upgrade',
    name: '酒店灯光场景样板间升级',
    description: '面向酒店客户打造样板间场景升级方案，整合筒灯、磁吸灯、氛围灯带与智能控制。',
    status: 'planning' as const,
    phase: '方案评审',
    owner: '赵六',
    members: ['赵六', '王五', '刘九', '乔霞'],
    targetDate: '2026-08-18',
    artifacts: [
      {
        title: '酒店样板间灯光方案池',
        artifactType: 'research' as const,
        createdBy: '王五',
        parseStatus: 'pending' as const,
        sourceRef: 'docs://lighting/hotel-scene-research',
        content: '收集酒店大堂、客房、走廊三类空间的照度需求、色温策略和控制场景建议。',
      },
    ],
  },
];

type SeedActionStatus = 'pending' | 'in_progress' | 'blocked' | 'done' | 'candidate';
type SeedPriority = 'high' | 'medium' | 'low';
type SeedMeetingStatus = 'review' | 'draft';

interface SeedActionItem {
  id: string;
  description: string;
  assignee: string | null;
  dueDate: string | null;
  priority: SeedPriority;
  status: SeedActionStatus;
  initialResult?: string;
  confidence?: { assignee?: number; dueDate?: number; priority?: number };
  sourceText?: string;
  category?: string;
}

interface SeedMeeting {
  projectKey: string;
  department: string;
  status: SeedMeetingStatus;
  title: string;
  type: string;
  meetingDate: string;
  participants: string[];
  organizer: string;
  content: string;
  summary: any;
  actionItems: SeedActionItem[];
}

interface SeedRequirement {
  title: string;
  description?: string | null;
  status: Requirement['status'];
  priority: Requirement['priority'];
  owner?: string | null;
  dueDate?: string | null;
  tags?: string[];
}

interface SeedRisk {
  title: string;
  description?: string | null;
  level: ProjectRisk['level'];
  status: ProjectRisk['status'];
  owner?: string | null;
  mitigationPlan?: string | null;
  dueDate?: string | null;
}

const requirementSeeds: Record<string, SeedRequirement[]> = {
  'smart-lighting-launch': [
    {
      title: '新品样册与安装说明同步定版',
      description: '样册、安装说明、包装唛头统一版本号，确保首发渠道物料一致。',
      status: 'in_review',
      priority: 'high',
      owner: '乔霞',
      dueDate: '2026-06-18',
      tags: ['样册', '包装', '上市'],
    },
    {
      title: '首批办公灯试产排期确认',
      status: 'draft',
      priority: 'medium',
      owner: '李四',
      dueDate: '2026-06-12',
      tags: ['试产', '交付'],
    },
  ],
  'ul-certification-switch': [
    {
      title: 'UL 认证整改资料补齐',
      description: '补齐安规 BOM、标签图、关键器件证书与温升测试记录。',
      status: 'approved',
      priority: 'high',
      owner: '陈七',
      dueDate: '2026-06-10',
      tags: ['UL', '认证', '资料'],
    },
    {
      title: '出口包装铭牌英文校对',
      description: '核对电压、功率、产地、型号编码等出口必备字段。',
      status: 'draft',
      priority: 'medium',
      owner: '乔霞',
      dueDate: '2026-06-08',
      tags: ['包装', '英文标识'],
    },
  ],
  'hotel-showroom-upgrade': [
    {
      title: '客房无主灯方案评审',
      description: '明确磁吸灯、灯带、床头阅读灯的组合与控制回路。',
      status: 'in_review',
      priority: 'high',
      owner: '赵六',
      dueDate: '2026-06-20',
      tags: ['酒店', '无主灯', '场景'],
    },
  ],
};

const riskSeeds: Record<string, SeedRisk[]> = {
  'smart-lighting-launch': [
    {
      title: '驱动板交期晚于样册发布时间',
      description: '驱动板供应商交期偏紧，可能影响样机拍摄与渠道上市节奏。',
      level: 'medium',
      status: 'open',
      owner: '李四',
      mitigationPlan: '提前锁定替代驱动板方案，同时安排样机先行拍摄。',
      dueDate: '2026-06-15',
    },
  ],
  'ul-certification-switch': [
    {
      title: 'UL 样品与量产版本不一致',
      description: '认证送检样品与量产 BOM 若未同步，可能导致重新送检。',
      level: 'high',
      status: 'open',
      owner: '周八',
      mitigationPlan: '建立认证样品冻结清单，试产前由工程与品质双签核对。',
      dueDate: '2026-06-09',
    },
  ],
  'hotel-showroom-upgrade': [
    {
      title: '样板间照度不达标',
      description: '若现场反射材料与设计假设偏差过大，可能造成实际照度不足。',
      level: 'medium',
      status: 'open',
      owner: '赵六',
      mitigationPlan: '现场复尺后复核灯位布点，并准备两档功率备选方案。',
      dueDate: '2026-06-22',
    },
  ],
};

// 造几份测试数据
export async function POST() {
  const meetingSeeds: SeedMeeting[] = [
    {
      projectKey: 'smart-lighting-launch',
      department: '产品中心',
      status: 'review',
      title: '智慧办公灯新品上市周例会',
      type: '新品评审',
      meetingDate: '2026-06-04',
      participants: ['张三', '李四', '王五', '赵六', '乔霞'],
      organizer: '张三',
      content: `[张三]: 今天主要过一遍智慧办公灯新品上市节奏，重点看样机、样册和首批试产。
[李四]: 结构件已经定版，驱动板还有两颗器件到货偏慢，试产时间可能要往后顺两天。
[王五]: 终端客户最关心的是防眩和UGR指标，样册里要把办公场景图和参数页放在前面。
[乔霞]: 我这边会把样册、安装说明和包装唛头一起收口，避免首发渠道拿到的资料不一致。
[赵六]: 展厅拍摄时间已经约了，下周二可以拍新品主视觉，但前提是样机外观不能再变。
[张三]: 好，今天定两件事，第一，乔霞负责物料版本统一；第二，李四负责驱动板风险兜底，不能影响上市节奏。
[李四]: 我会准备A/B两个驱动方案，本周五前给结论。
[乔霞]: 样册我会先出销售版，再补安装细节版，保证老板明天演示时有完整内容。`,
      summary: {
        overview: '会议聚焦智慧办公灯新品上市准备，明确了样机外观冻结、样册与包装资料统一、驱动板备选方案和展厅拍摄节奏，确保渠道首发与演示素材同步到位。',
        keyTopics: [
          { topic: '样机定版', description: '外观和结构件已基本冻结，等待驱动板最终确认', importance: 'high' },
          { topic: '销售物料统一', description: '样册、安装说明和包装唛头需要统一版本号', importance: 'high' },
          { topic: '展厅拍摄节奏', description: '下周安排主视觉拍摄，依赖样机稳定交付', importance: 'medium' },
        ],
        decisions: [
          { decision: '物料版本统一后再对外发布', rationale: '避免销售样册与实际包装信息不一致', impact: '降低渠道误传风险', stakeholders: ['张三', '乔霞', '王五'] },
          { decision: '驱动板准备双方案兜底', rationale: '防止关键器件交期影响试产', impact: '保障上市节奏', stakeholders: ['张三', '李四'] },
        ],
        risks: [
          { risk: '驱动板关键器件到货晚于计划', probability: 'medium', impact: 'high', mitigation: '准备备选驱动板并前置验证' },
          { risk: '样册版本与包装标识不一致', probability: 'medium', impact: 'medium', mitigation: '由乔霞统一版本号并校对' },
        ],
        nextSteps: [
          { step: '输出样册与安装说明统一版本', owner: '乔霞', timeline: '6月8日', priority: 'high' },
          { step: '确认驱动板 A/B 方案', owner: '李四', timeline: '本周五', priority: 'high' },
          { step: '准备展厅拍摄清单', owner: '赵六', timeline: '下周二前', priority: 'medium' },
        ],
        participants: ['张三', '李四', '王五', '赵六', '乔霞'],
        meetingDate: '2026-06-04',
        estimatedDuration: '50分钟',
        title: '智慧办公灯新品上市周例会',
      },
      actionItems: [
        {
          id: 'light-action-1',
          description: '统一智慧办公灯样册、安装说明和包装唛头版本',
          assignee: '乔霞',
          dueDate: '2026-06-08',
          priority: 'high',
          status: 'pending',
          initialResult: '输出可对外演示的销售版样册，并同步安装说明与包装版本号。',
          confidence: { assignee: 0.95, dueDate: 0.9, priority: 0.95 },
          sourceText: '乔霞: 我这边会把样册、安装说明和包装唛头一起收口，避免首发渠道拿到的资料不一致。',
          category: 'task',
        },
        {
          id: 'light-action-2',
          description: '确认驱动板 A/B 备选方案并输出风险结论',
          assignee: '李四',
          dueDate: '2026-06-07',
          priority: 'high',
          status: 'in_progress',
          initialResult: '形成器件到货风险判断与两套驱动板切换建议。',
          confidence: { assignee: 0.95, dueDate: 0.85, priority: 0.9 },
          sourceText: '李四: 我会准备A/B两个驱动方案，本周五前给结论。',
          category: 'task',
        },
        {
          id: 'light-action-3',
          description: '准备新品展厅拍摄清单和场景陈列道具',
          assignee: '赵六',
          dueDate: '2026-06-09',
          priority: 'medium',
          status: 'pending',
          initialResult: '确认主视觉拍摄清单、场景灯位和陈列道具明细。',
          confidence: { assignee: 0.9, dueDate: 0.8, priority: 0.8 },
          sourceText: '赵六: 展厅拍摄时间已经约了，下周二可以拍新品主视觉。',
          category: 'task',
        },
        {
          id: 'light-action-4',
          description: '确认老板演示版样机外观冻结清单',
          assignee: '张三',
          dueDate: '2026-06-06',
          priority: 'medium',
          status: 'done',
          initialResult: '样机外观版本冻结，演示物料和拍摄物料可同步输出。',
          confidence: { assignee: 0.9, dueDate: 0.8, priority: 0.8 },
          sourceText: '张三: 今天定两件事，第一，乔霞负责物料版本统一；第二，李四负责驱动板风险兜底。',
          category: 'follow-up',
        },
        {
          id: 'light-action-5',
          description: '补充 UGR 与防眩测试页到销售版样册',
          assignee: '乔霞',
          dueDate: '2026-06-10',
          priority: 'medium',
          status: 'in_progress',
          initialResult: '样册增加办公场景参数页，突出防眩和照度卖点。',
          confidence: { assignee: 0.92, dueDate: 0.78, priority: 0.82 },
          sourceText: '王五: 终端客户最关心的是防眩和UGR指标，样册里要把办公场景图和参数页放在前面。',
          category: 'task',
        },
        {
          id: 'light-action-6',
          description: '确认经销商首批订货预测',
          assignee: null,
          dueDate: null,
          priority: 'medium',
          status: 'candidate',
          initialResult: '形成经销商首批订货预测表，支持产能排期。',
          confidence: { assignee: 0.1, dueDate: 0.1, priority: 0.6 },
          sourceText: '会议待补充：渠道首发数量需要销售和供应链联动确认。',
          category: 'task',
        },
      ],
    },
    {
      projectKey: 'ul-certification-switch',
      department: '工程中心',
      status: 'review',
      title: '北美线性灯 UL 认证整改会',
      type: '认证评审',
      meetingDate: '2026-06-03',
      participants: ['李四', '陈七', '周八', '乔霞'],
      organizer: '李四',
      content: `[李四]: 今天重点过一遍北美线性灯 UL 认证整改项，尤其是标签、BOM 和温升测试。
[陈七]: 目前接线端子和外壳阻燃等级已经换成合规料件，但资料包还差两份器件证书。
[周八]: 上周实验室反馈温升测试还有一组数据要补测，不然送检资料不能关闭。
[乔霞]: 包装铭牌英文我已经改了一版，但型号编码和功率描述需要和工程再对一次。
[李四]: 好，认证资料和包装标识必须一起收口，不能出现送检样品和量产版本不一致。
[陈七]: 我今天下班前把缺失证书清单发出来。
[周八]: 温升补测我安排明天上午做，下午给报告。
[乔霞]: 我收到报告后会同步更新出口包装铭牌和说明书英文页。`,
      summary: {
        overview: '会议围绕北美线性灯 UL 认证整改展开，明确了证书缺口、温升补测、英文包装铭牌和送检样品冻结清单，目标是在本周内完成送检前资料闭环。',
        keyTopics: [
          { topic: '证书缺口', description: '有两份关键器件证书尚未归档', importance: 'high' },
          { topic: '温升补测', description: '实验室要求补齐一组温升测试数据', importance: 'high' },
          { topic: '出口标识', description: '英文包装铭牌需与工程 BOM 和功率描述一致', importance: 'medium' },
        ],
        decisions: [
          { decision: '认证资料与包装标识同步收口', rationale: '避免认证样品与量产版本不一致', impact: '降低重新送检风险', stakeholders: ['李四', '陈七', '乔霞'] },
          { decision: '温升补测结果当天回传', rationale: '压缩认证整改周期', impact: '保障出货计划', stakeholders: ['李四', '周八'] },
        ],
        risks: [
          { risk: '送检样品和量产 BOM 不一致', probability: 'medium', impact: 'high', mitigation: '建立冻结清单并双签确认' },
          { risk: '包装英文标识错误导致客户投诉', probability: 'medium', impact: 'medium', mitigation: '由乔霞完成英文页复核' },
        ],
        nextSteps: [
          { step: '补齐关键器件证书清单', owner: '陈七', timeline: '今天', priority: 'high' },
          { step: '完成温升补测并输出报告', owner: '周八', timeline: '明天下午', priority: 'high' },
          { step: '更新出口包装铭牌英文页', owner: '乔霞', timeline: '收到报告后当日', priority: 'medium' },
        ],
        participants: ['李四', '陈七', '周八', '乔霞'],
        meetingDate: '2026-06-03',
        estimatedDuration: '40分钟',
        title: '北美线性灯 UL 认证整改会',
      },
      actionItems: [
        {
          id: 'uc-action-1',
          description: '补齐 UL 关键器件证书与送检资料包',
          assignee: '陈七',
          dueDate: '2026-06-06',
          priority: 'high',
          status: 'in_progress',
          initialResult: '完成送检资料包归档，保证实验室可直接受理。',
          confidence: { assignee: 0.9, dueDate: 0.8, priority: 0.9 },
          sourceText: '陈七: 我今天下班前把缺失证书清单发出来。',
          category: 'task',
        },
        {
          id: 'uc-action-2',
          description: '完成温升补测并回传报告',
          assignee: '周八',
          dueDate: '2026-06-05',
          priority: 'medium',
          status: 'pending',
          initialResult: '实验室补测报告齐全，可用于关闭认证问题项。',
          confidence: { assignee: 0.92, dueDate: 0.8, priority: 0.78 },
          sourceText: '周八: 温升补测我安排明天上午做，下午给报告。',
          category: 'task',
        },
        {
          id: 'uc-action-3',
          description: '更新出口包装铭牌与说明书英文页',
          assignee: '乔霞',
          dueDate: '2026-06-06',
          priority: 'medium',
          status: 'pending',
          initialResult: '英文标识与工程 BOM、功率描述完全一致，可直接用于出口包装。',
          confidence: { assignee: 0.95, dueDate: 0.75, priority: 0.82 },
          sourceText: '乔霞: 我收到报告后会同步更新出口包装铭牌和说明书英文页。',
          category: 'task',
        },
        {
          id: 'uc-action-4',
          description: '建立认证样品冻结清单',
          assignee: null,
          dueDate: null,
          priority: 'medium',
          status: 'candidate',
          initialResult: '送检样品、量产版本、BOM 版本三者可追溯。',
          confidence: { assignee: 0.1, dueDate: 0.1, priority: 0.6 },
          sourceText: '李四: 认证资料和包装标识必须一起收口，不能出现送检样品和量产版本不一致。',
          category: 'task',
        },
      ],
    },
  ];

  const [existingProjects, existingMeetings] = await Promise.all([
    getProjects(),
    getMeetings(),
  ]);

  const projectIdMap = new Map<string, string>();
  const projectResults: { id: string; name: string; status: 'created' | 'existing' }[] = [];
  let createdArtifacts = 0;

  for (const projectSeed of projectSeeds) {
    const ownerLoginId = loginIdMap[projectSeed.owner] || null;
    const existing = existingProjects.find(p => p.name === projectSeed.name);
    const project = existing
      ? existing
      : await createProject({
          name: projectSeed.name,
          description: projectSeed.description,
          status: projectSeed.status,
          phase: projectSeed.phase,
          owner: projectSeed.owner,
          ownerLoginId,
          members: projectSeed.members,
          targetDate: projectSeed.targetDate,
        });

    if (!existing) {
      existingProjects.push(project);
    }

    projectIdMap.set(projectSeed.key, project.id);
    projectResults.push({ id: project.id, name: projectSeed.name, status: existing ? 'existing' : 'created' });

    if (projectSeed.artifacts?.length) {
      const existingArtifacts = await getArtifactsByProject(project.id);
      for (const artifactSeed of projectSeed.artifacts) {
        if (existingArtifacts.some(a => a.title === artifactSeed.title)) continue;
        await createArtifact({
          projectId: project.id,
          artifactType: artifactSeed.artifactType,
          title: artifactSeed.title,
          content: artifactSeed.content || null,
          sourceRef: artifactSeed.sourceRef || null,
          parseStatus: artifactSeed.parseStatus,
          createdBy: artifactSeed.createdBy || projectSeed.owner,
        });
        createdArtifacts++;
      }
    }
  }

  const meetingResults: { id: string; title: string; status: 'created' | 'updated' }[] = [];
  let createdActionItems = 0;

  for (const seed of meetingSeeds) {
    const projectId = seed.projectKey ? projectIdMap.get(seed.projectKey) || null : null;
    let meeting = existingMeetings.find(m => m.title === seed.title && (!projectId || m.projectId === projectId));

    if (!meeting) {
      meeting = await createMeeting({
        title: seed.title,
        type: seed.type,
        meetingDate: seed.meetingDate,
        participants: seed.participants,
        organizer: seed.organizer,
        organizerLoginId: loginIdMap[seed.organizer] || undefined,
        department: seed.department,
        projectId,
        status: seed.status ?? 'review',
        content: seed.content,
      } as any);
      existingMeetings.push(meeting);
      meetingResults.push({ id: meeting.id, title: seed.title, status: 'created' });
    } else {
      meetingResults.push({ id: meeting.id, title: seed.title, status: 'updated' });
    }

    await updateMeeting(meeting.id, {
      projectId,
      summary: seed.summary,
      actionItems: seed.actionItems,
      status: seed.status ?? 'review',
      content: seed.content,
      department: seed.department,
    });

    for (const item of seed.actionItems) {
      const existingAction = await getActionItemByMeetingAndOriginalId(meeting.id, item.id);
      if (existingAction) continue;
      const resolvedOwner = await resolveActionOwnerIdentity({
        owner: item.assignee || null,
        ownerLoginId: item.assignee ? loginIdMap[item.assignee] || null : null,
        ownerOaId: null,
        dept: seed.department || null,
      });

      await createActionItem({
        projectId,
        meetingId: meeting.id,
        artifactId: null,
        originalId: item.id,
        description: item.description,
        owner: resolvedOwner.owner,
        ownerLoginId: resolvedOwner.ownerLoginId,
        ownerOaId: resolvedOwner.ownerOaId,
        dept: resolvedOwner.dept || seed.department || null,
        dueDate: item.dueDate || null,
        priority: item.priority ?? 'medium',
        status: item.status ?? 'pending',
        confidenceOwner: item.confidence?.assignee ?? null,
        confidenceDate: item.confidence?.dueDate ?? null,
        sourceText: item.sourceText || null,
        initialResult: item.initialResult || null,
        confirmedBy: null,
        confirmedAt: null,
        completedBy: item.status === 'done' ? item.assignee || null : null,
        completedAt: item.status === 'done' ? item.dueDate || new Date().toISOString() : null,
        completionNote: item.status === 'done' ? '流程完成，进入落地执行阶段' : null,
        evidenceFiles: [],
        blockReason: item.status === 'blocked' ? '等待资源协调' : null,
        blockedBy: item.status === 'blocked' ? item.assignee || seed.organizer : null,
        blockedAt: item.status === 'blocked' ? new Date().toISOString() : null,
        oaResult: null,
        oaResultAt: null,
        oaScore: null,
        oaAutoDetected: false,
        oaAttachments: [],
      });
      createdActionItems++;
    }
  }

  let createdRequirements = 0;
  let createdRisks = 0;

  for (const [projectKey, reqSeeds] of Object.entries(requirementSeeds)) {
    const projectId = projectIdMap.get(projectKey);
    if (!projectId || !reqSeeds.length) continue;
    const existingRequirements = await getRequirementsByProject(projectId);
    for (const reqSeed of reqSeeds) {
      if (existingRequirements.some(req => req.title === reqSeed.title)) continue;
      await createRequirement({
        projectId,
        title: reqSeed.title,
        description: reqSeed.description ?? null,
        status: reqSeed.status,
        priority: reqSeed.priority,
        owner: reqSeed.owner ?? null,
        ownerLoginId: reqSeed.owner ? loginIdMap[reqSeed.owner] || null : null,
        relatedArtifactId: null,
        tags: reqSeed.tags ?? [],
        dueDate: reqSeed.dueDate ?? null,
      });
      createdRequirements++;
    }
  }

  for (const [projectKey, riskSeedsForProject] of Object.entries(riskSeeds)) {
    const projectId = projectIdMap.get(projectKey);
    if (!projectId || !riskSeedsForProject.length) continue;
    const existingRisks = await getRisksByProject(projectId);
    for (const riskSeed of riskSeedsForProject) {
      if (existingRisks.some(risk => risk.title === riskSeed.title)) continue;
      await createProjectRisk({
        projectId,
        title: riskSeed.title,
        description: riskSeed.description ?? null,
        level: riskSeed.level,
        status: riskSeed.status,
        owner: riskSeed.owner ?? null,
        ownerLoginId: riskSeed.owner ? loginIdMap[riskSeed.owner] || null : null,
        relatedActionId: null,
        detectedBy: 'manual',
        mitigationPlan: riskSeed.mitigationPlan ?? null,
        dueDate: riskSeed.dueDate ?? null,
      });
      createdRisks++;
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      projects: projectResults,
      meetings: meetingResults,
      createdArtifacts,
      createdActionItems,
      createdRequirements,
      createdRisks,
    },
  });
}
