import * as sql from 'mssql';

/**
 * 数据库事务辅助工具
 * 用于确保多个数据库操作的原子性
 */

export interface TransactionContext {
  transaction: sql.Transaction;
  request(): sql.Request;
}

/**
 * 在事务中执行操作
 * @param pool SQL连接池
 * @param callback 事务回调函数
 * @returns 回调函数的返回值
 */
export async function withTransaction<T>(
  pool: sql.ConnectionPool,
  callback: (ctx: TransactionContext) => Promise<T>
): Promise<T> {
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();

    const ctx: TransactionContext = {
      transaction,
      request: () => new sql.Request(transaction),
    };

    const result = await callback(ctx);
    await transaction.commit();

    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      console.error('[Transaction] Rollback failed:', rollbackError);
    }
    throw error;
  }
}
