"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex items-center justify-center h-full p-8">
            <div className="text-center">
              <div className="text-sm font-medium text-destructive mb-2">组件加载失败</div>
              <div className="text-xs text-muted-foreground">
                {this.state.error?.message || "未知错误"}
              </div>
              <button
                onClick={() => this.setState({ hasError: false, error: undefined })}
                className="mt-3 text-xs text-accent hover:underline"
              >
                重试
              </button>
            </div>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
