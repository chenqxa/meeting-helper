import { NextResponse } from 'next/server';
import { createDepartment, createEmployee, getDepartments } from '@/storage/database/org-storage';

// POST /api/org/init - 初始化模拟组织架构数据
export async function POST() {
  try {
    // 检查是否已有数据
    const existing = await getDepartments();
    if (existing.length > 0) {
      return NextResponse.json({ success: false, error: '组织架构数据已存在' }, { status: 400 });
    }

    // 创建部门
    const rootDept = await createDepartment({ name: '总公司', code: 'HQ', parentId: null, sort: 1, status: 'active' });
    const itDept = await createDepartment({ name: '技术部', code: 'IT', parentId: rootDept.id, sort: 1, status: 'active' });
    const productDept = await createDepartment({ name: '产品部', code: 'PD', parentId: rootDept.id, sort: 2, status: 'active' });
    const salesDept = await createDepartment({ name: '销售部', code: 'SD', parentId: rootDept.id, sort: 3, status: 'active' });
    const hrDept = await createDepartment({ name: '人力资源部', code: 'HR', parentId: rootDept.id, sort: 4, status: 'active' });
    const financeDept = await createDepartment({ name: '财务部', code: 'FD', parentId: rootDept.id, sort: 5, status: 'active' });

    // 技术部子部门
    const devTeam = await createDepartment({ name: '研发组', code: 'DEV', parentId: itDept.id, sort: 1, status: 'active' });
    const opsTeam = await createDepartment({ name: '运维组', code: 'OPS', parentId: itDept.id, sort: 2, status: 'active' });

    // 创建员工
    await createEmployee({ name: '张伟', code: 'E0001', position: '总经理', departmentId: rootDept.id, status: 'active', joinedAt: '2020-01-15' });
    await createEmployee({ name: '李娜', code: 'E0002', position: '技术总监', departmentId: itDept.id, status: 'active', joinedAt: '2020-03-01' });
    await createEmployee({ name: '王强', code: 'E0003', position: '产品总监', departmentId: productDept.id, status: 'active', joinedAt: '2020-02-20' });
    await createEmployee({ name: '刘芳', code: 'E0004', position: '销售总监', departmentId: salesDept.id, status: 'active', joinedAt: '2020-04-10' });
    await createEmployee({ name: '陈明', code: 'E0005', position: 'HR经理', departmentId: hrDept.id, status: 'active', joinedAt: '2020-05-01' });
    await createEmployee({ name: '赵丽', code: 'E0006', position: '财务经理', departmentId: financeDept.id, status: 'active', joinedAt: '2020-06-15' });
    await createEmployee({ name: '孙杰', code: 'E0007', position: '前端工程师', departmentId: devTeam.id, status: 'active', joinedAt: '2021-07-01' });
    await createEmployee({ name: '周婷', code: 'E0008', position: '后端工程师', departmentId: devTeam.id, status: 'active', joinedAt: '2021-08-15' });
    await createEmployee({ name: '吴磊', code: 'E0009', position: '运维工程师', departmentId: opsTeam.id, status: 'active', joinedAt: '2021-09-01' });
    await createEmployee({ name: '郑洋', code: 'E0010', position: '产品经理', departmentId: productDept.id, status: 'active', joinedAt: '2021-10-20' });
    await createEmployee({ name: '何静', code: 'E0011', position: '销售代表', departmentId: salesDept.id, status: 'active', joinedAt: '2022-01-10' });
    await createEmployee({ name: '冯涛', code: 'E0012', position: '前端工程师', departmentId: devTeam.id, status: 'active', joinedAt: '2022-03-01' });
    await createEmployee({ name: '袁琳', code: 'E0013', position: '后端工程师', departmentId: devTeam.id, status: 'active', joinedAt: '2022-04-15' });
    await createEmployee({ name: '邓超', code: 'E0014', position: '测试工程师', departmentId: devTeam.id, status: 'active', joinedAt: '2022-05-20' });
    await createEmployee({ name: '彭飞', code: 'E0015', position: '运维工程师', departmentId: opsTeam.id, status: 'active', joinedAt: '2022-06-01' });
    await createEmployee({ name: '曹磊', code: 'E0016', position: 'UI设计师', departmentId: productDept.id, status: 'active', joinedAt: '2022-07-15' });
    await createEmployee({ name: '魏敏', code: 'E0017', position: '招聘专员', departmentId: hrDept.id, status: 'active', joinedAt: '2022-08-20' });
    await createEmployee({ name: '薛峰', code: 'E0018', position: '会计', departmentId: financeDept.id, status: 'active', joinedAt: '2022-09-01' });
    await createEmployee({ name: '阎强', code: 'E0019', position: '销售代表', departmentId: salesDept.id, status: 'active', joinedAt: '2022-10-10' });
    await createEmployee({ name: '沈芳', code: 'E0020', position: '前端工程师', departmentId: devTeam.id, status: 'active', joinedAt: '2023-01-15' });

    return NextResponse.json({ success: true, message: '初始化成功' });
  } catch (error) {
    console.error('Init Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
