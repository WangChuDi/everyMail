import type { Router, Request, Response, NextFunction } from 'express';
import type { BackendAdapter } from '../adapters/base.js';

/**
 * FrontendFormat 接口
 *
 * 每种前端 API 格式实现此接口，自包含：
 * - 路由注册
 * - 认证中间件
 * - 响应格式转换
 */
export interface FrontendFormat {
  /** 格式名称（用于配置和日志） */
  readonly name: string;

  /** 路由前缀（必须唯一，避免冲突） */
  readonly routePrefix: string;

  /**
   * 注册此格式的所有路由到给定 router
   * @param router Express Router 实例
   * @param adapter 后端适配器（任意后端）
   */
  registerRoutes(router: Router, adapter: BackendAdapter): void;

  /**
   * 创建此格式的认证中间件
   * @returns Express 中间件函数，或 null（无需认证）
   */
  createAuthMiddleware(): ((req: Request, res: Response, next: NextFunction) => void) | null;
}
