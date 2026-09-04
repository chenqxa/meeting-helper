// 将 meetings-data.json 导入 SQL Server
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { createMeeting, updateMeeting } from '../src/storage';

async function main() {
  const file = path.join(__dirname, '..', 'meetings-data.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const meetings = raw.meetings || [];

  console.log(`共 ${meetings.length} 条会议记录待导入`);

  for (const m of meetings) {
    try {
      const created = await createMeeting({
        title: m.title,
        type: m.type,
        organizer: m.organizer,
        meetingDate: m.meetingDate || '',
        participants: m.participants || [],
        status: m.status || 'draft',
        content: m.content || '',
        department: m.department || undefined,
        summary: m.summary || undefined,
        actionItems: m.actionItems || [],
      });

      // 恢复版本和锁定状态
      if (m.version > 1 || m.locked_version) {
        await updateMeeting(created.id, {
          version: m.version || 1,
          locked_version: m.locked_version || undefined,
          status: m.status || 'draft',
        });
      }

      console.log(`✅ 导入: ${m.title} (${created.id})`);
    } catch (err) {
      console.error(`❌ 失败: ${m.title}`, err);
    }
  }

  console.log('导入完成');
  process.exit(0);
}

main();
