// ─── PLUTO: граница ошибок — диагностика вместо белого экрана ───────────────
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[PLUTO] ошибка интерфейса:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error.message || String(this.state.error);
    const stale = /useMemo|useState|useEffect|useRef|hook/i.test(msg);

    return (
      <div className="flex h-screen items-center justify-center bg-[#0b0e1a] p-6 text-[#dfe3f5]">
        <div className="w-full max-w-lg rounded-xl border border-[#242b4a] bg-[#12162a] p-7 shadow-[0_30px_80px_-20px_rgba(0,0,0,.8)]">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="h-8 w-8 text-[#e07a80]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 2.5 20h19Z" />
              <path d="M12 9.5V14M12 17h.01" />
            </svg>
            <div>
              <div className="font-mono text-[17px] font-bold tracking-[0.2em]">PLUTO</div>
              <div className="text-[11px] uppercase tracking-[0.15em] text-[#8b93b8]">интерфейс остановлен ошибкой</div>
            </div>
          </div>

          <p className="mt-5 text-[13px] leading-relaxed text-[#aeb6d8]">
            {stale
              ? 'Похоже, браузер загрузил устаревший пакет интерфейса. Нажмите Ctrl+Shift+R; если не поможет — пересоберите образ: git pull && docker compose up -d --build.'
              : 'Компонент консоли упал с ошибкой. Перезагрузите страницу; если ошибка повторяется — пересоберите образ и пришлите текст ниже.'}
          </p>

          <div className="mt-4 max-h-40 overflow-auto rounded-lg border border-[#242b4a] bg-[#0b0e1a] p-3 font-mono text-[11.5px] leading-relaxed text-[#e07a80]">
            {msg}
          </div>

          <div className="mt-5 flex gap-2">
            <button
              onClick={() => location.reload()}
              className="rounded-lg border border-[#8f7df0]/50 bg-[#8f7df0]/15 px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-[#8f7df0]/25"
            >
              Перезагрузить страницу
            </button>
            <button
              onClick={() => {
                localStorage.removeItem('pluto_token');
                location.reload();
              }}
              className="rounded-lg border border-[#242b4a] bg-[#181d36] px-4 py-2 text-[13px] font-semibold text-[#aeb6d8] transition-colors hover:text-[#dfe3f5]"
            >
              Сбросить сессию
            </button>
          </div>
        </div>
      </div>
    );
  }
}
