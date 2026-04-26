'use client';

import Link from 'next/link';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatToolInput, toolStyle } from './feedHelpers';
import type { FeedItem, Status } from './streamTypes';

export type SaveState = 'idle' | 'saving' | 'saved';

type Props = {
  // Panel position + drag/minimize controls
  panelRef: RefObject<HTMLDivElement | null>;
  panelPos: { x: number; y: number };
  minimized: boolean;
  setMinimized: Dispatch<SetStateAction<boolean>>;
  onHeaderMouseDown: (e: React.MouseEvent) => void;

  // Stream state
  status: Status;
  sessionId: string | null;
  feed: FeedItem[];
  chatScrollRef: RefObject<HTMLDivElement | null>;

  // Composer state
  goal: string;
  setGoal: Dispatch<SetStateAction<string>>;
  redirectText: string;
  setRedirectText: Dispatch<SetStateAction<string>>;
  followupText: string;
  setFollowupText: Dispatch<SetStateAction<string>>;
  saveName: string;
  setSaveName: Dispatch<SetStateAction<string>>;
  saveState: SaveState;
  setSaveState: Dispatch<SetStateAction<SaveState>>;

  // Actions
  onBuild: () => void;
  onPause: () => void;
  onRedirect: () => void;
  onFollowup: () => void;
  onSaveCity: () => void;
};

function StatusBadge({ status }: { status: Status }) {
  const color =
    status === 'running' ? 'text-cyan-400 animate-pulse' :
    status === 'paused'  ? 'text-amber-400' :
    status === 'done'    ? 'text-sky-400' :
                           'text-white/60';
  return <span className={`uppercase ${color}`}>{status}</span>;
}

export function ChatPanel({
  panelRef,
  panelPos,
  minimized,
  setMinimized,
  onHeaderMouseDown,
  status,
  sessionId,
  feed,
  chatScrollRef,
  goal,
  setGoal,
  redirectText,
  setRedirectText,
  followupText,
  setFollowupText,
  saveName,
  setSaveName,
  saveState,
  setSaveState,
  onBuild,
  onPause,
  onRedirect,
  onFollowup,
  onSaveCity,
}: Props) {
  const isBuilding = status === 'running' || status === 'paused';

  return (
    <div
      data-mayor-ui
      ref={panelRef}
      className={`absolute w-[26rem] flex flex-col bg-[#0b1220] text-white font-mono border-2 border-white/90 ${minimized ? '' : 'h-[75vh]'}`}
      style={{
        left: panelPos.x,
        top: panelPos.y,
        imageRendering: 'pixelated',
        boxShadow: '4px 4px 0 0 rgba(0,0,0,0.85), inset 0 0 0 2px #1a2540',
      }}
    >
      {/* Header — drag handle */}
      <div
        onMouseDown={onHeaderMouseDown}
        className="cursor-move select-none flex justify-between items-center px-3 py-2 bg-[#1a2540] border-b-2 border-white/90 uppercase tracking-[0.2em] text-[10px] shrink-0"
      >
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 bg-cyan-400" />
          <span className="opacity-60">⠿</span>
          MetroPrompt · Mayor
        </span>
        <span className="flex items-center gap-2">
          <StatusBadge status={status} />
          <button
            onClick={() => setMinimized(m => !m)}
            className="px-1.5 py-[1px] text-[10px] leading-none border border-white/40 hover:bg-white/10 hover:border-white/70 transition-colors"
            title={minimized ? 'restore' : 'minimize'}
          >
            {minimized ? '▢' : '_'}
          </button>
        </span>
      </div>

      {!minimized && (<>

      {/* Feed */}
      <div
        ref={chatScrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-2 text-[11px]"
      >
        {feed.length === 0 && (
          <div className="text-white/40 text-center pt-8 uppercase tracking-wider text-[10px] leading-relaxed">
            ▒▒ no transmissions ▒▒
            <br />
            <span className="opacity-60">describe a city below to start</span>
          </div>
        )}
        {feed.map((entry) => {
          if (entry.kind === 'message') {
            const isMayor = entry.author === 'mayor';
            const label = isMayor ? 'MAYOR' : 'ZONE';
            const dot = isMayor ? 'bg-cyan-400' : 'bg-emerald-400';
            const labelText = isMayor ? 'text-cyan-300' : 'text-emerald-300';
            const headBg = isMayor ? 'bg-cyan-500/15' : 'bg-emerald-500/15';
            const headBorder = isMayor ? 'border-cyan-400/70' : 'border-emerald-400/70';
            return (
              <div
                key={entry.id}
                className={`border-2 ${headBorder} bg-black/40`}
                style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.7)' }}
              >
                <div className={`flex items-center gap-1.5 px-2 py-1 ${headBg} border-b-2 ${headBorder} uppercase tracking-[0.2em] text-[9px]`}>
                  <span className={`inline-block w-2 h-2 ${dot}`} />
                  <span className={labelText}>{label}</span>
                </div>
                <div className="px-3 py-2 leading-relaxed chat-md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {entry.text}
                  </ReactMarkdown>
                </div>
              </div>
            );
          }
          // tool_batch
          const ts = toolStyle(entry.name);
          const total = entry.items.length;
          const okCount = entry.items.filter(it => it.ok).length;
          const failCount = total - okCount;
          const sourceTag = entry.source === 'zone' ? 'ZONE' : 'MAYOR';
          const sourceTagCls = entry.source === 'zone' ? 'text-emerald-300' : 'text-cyan-300';
          const previewCount = 6;
          const previewItems = entry.items.slice(0, previewCount);
          const remaining = total - previewItems.length;
          return (
            <div
              key={entry.id}
              className={`border-2 ${ts.borderCls} bg-black/30`}
              style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.7)' }}
            >
              <div className={`flex items-center justify-between px-2 py-1 ${ts.bgCls} border-b-2 ${ts.borderCls} uppercase tracking-[0.18em] text-[9px]`}>
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block w-2 h-2 ${ts.dotCls}`} />
                  <span className={sourceTagCls}>{sourceTag}</span>
                  <span className="opacity-50">·</span>
                  <span className={ts.textCls}>{ts.glyph} {entry.name}</span>
                  {total > 1 && <span className="opacity-70">×{total}</span>}
                </span>
                <span className="flex items-center gap-1.5">
                  {failCount > 0 && (
                    <span className="text-rose-300">✗{failCount}</span>
                  )}
                  {okCount > 0 && (
                    <span className="text-emerald-300">✓{okCount}</span>
                  )}
                </span>
              </div>
              <div className="px-2 py-1.5 text-[10px] leading-snug font-mono space-y-0.5">
                {previewItems.map(it => (
                  <div
                    key={it.toolUseId}
                    className={`flex items-start gap-1.5 ${it.ok ? 'text-white/85' : 'text-rose-300/90'}`}
                  >
                    <span className={it.ok ? 'opacity-60' : ''}>
                      {it.ok ? '›' : '✗'}
                    </span>
                    <span className="break-all">
                      {formatToolInput(it.name, it.input)}
                      {!it.ok && it.error && (
                        <span className="opacity-70"> — {it.error}</span>
                      )}
                    </span>
                  </div>
                ))}
                {remaining > 0 && (
                  <div className="text-white/40 italic">+ {remaining} more…</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer (controls dock) */}
      <div className="border-t-2 border-white/90 bg-[#0d1424] p-3 space-y-2 shrink-0">
        {status === 'paused' ? (
          <>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-amber-300">
              <span className="inline-block w-2 h-2 bg-amber-400 animate-pulse" />
              Mayor paused — send a nudge to resume
            </div>
            <textarea
              value={redirectText}
              onChange={(e) => setRedirectText(e.target.value)}
              rows={2}
              className="w-full p-2 bg-black/60 text-white text-xs border-2 border-white/40 focus:border-emerald-400 outline-none resize-none"
              placeholder="e.g. focus on downtown, more parks…"
            />
            <button
              onClick={onRedirect}
              disabled={!redirectText.trim()}
              className="w-full py-2 bg-emerald-400 hover:bg-emerald-300 disabled:bg-white/10 disabled:text-white/40 text-black text-xs font-bold uppercase tracking-wider border-2 border-white/90 transition-colors"
              style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
            >
              ▶ Resume with nudge
            </button>
          </>
        ) : status === 'done' && sessionId ? (
          <>
            {/* Save card */}
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-lime-300">
              <span className="inline-block w-2 h-2 bg-lime-400" />
              Save this city locally
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={saveName}
                onChange={(e) => { setSaveName(e.target.value); if (saveState === 'saved') setSaveState('idle'); }}
                placeholder="name your city…"
                className="flex-1 min-w-0 px-2 py-1.5 bg-black/60 text-white text-xs border-2 border-white/40 focus:border-lime-400 outline-none"
              />
              <button
                onClick={onSaveCity}
                disabled={!saveName.trim() || saveState === 'saving'}
                className="shrink-0 px-3 py-1.5 bg-lime-400 hover:bg-lime-300 disabled:bg-white/10 disabled:text-white/40 text-black text-[10px] font-bold uppercase tracking-wider border-2 border-white/90 transition-colors"
                style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
              >
                {saveState === 'saved' ? '✓ saved' : saveState === 'saving' ? '…' : '💾 save'}
              </button>
            </div>
            {saveState === 'saved' && (
              <div className="text-[10px] text-lime-300/90">
                Saved · <Link href="/cities" className="underline hover:text-lime-200">view My Cities →</Link>
              </div>
            )}

            <div className="border-t border-white/15 my-1" />

            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-sky-300">
              <span className="inline-block w-2 h-2 bg-sky-400" />
              Build complete — send a follow-up to edit the city
            </div>
            <textarea
              value={followupText}
              onChange={(e) => setFollowupText(e.target.value)}
              rows={3}
              className="w-full p-2 bg-black/60 text-white text-xs border-2 border-white/40 focus:border-fuchsia-400 outline-none resize-none"
              placeholder="e.g. remove the hospital and put a park there, add more trees along the main road…"
            />
            <button
              onClick={onFollowup}
              disabled={!followupText.trim()}
              className="w-full py-2 bg-fuchsia-400 hover:bg-fuchsia-300 disabled:bg-white/10 disabled:text-white/40 text-black text-xs font-bold uppercase tracking-wider border-2 border-white/90 transition-colors"
              style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
            >
              ✎ Send follow-up
            </button>
            <button
              onClick={onBuild}
              disabled={!goal.trim()}
              className="w-full py-1.5 bg-transparent hover:bg-white/5 disabled:opacity-40 text-white/60 hover:text-white text-[10px] uppercase tracking-wider border border-white/30"
              title="Discard the current city and start a brand-new build with the goal above"
            >
              ↺ start over with new goal
            </button>
          </>
        ) : (
          <>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              disabled={isBuilding}
              rows={3}
              className="w-full p-2 bg-black/60 text-white text-xs border-2 border-white/40 focus:border-cyan-400 outline-none resize-none disabled:opacity-50"
              placeholder="Describe the city you want the Mayor to build…"
            />
            {status === 'running' ? (
              <button
                onClick={onPause}
                className="w-full py-2 bg-amber-400 hover:bg-amber-300 text-black text-xs font-bold uppercase tracking-wider border-2 border-white/90 transition-colors"
                style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
              >
                ❚❚ Pause Mayor
              </button>
            ) : (
              <button
                onClick={onBuild}
                disabled={!goal.trim()}
                className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 disabled:bg-white/10 disabled:text-white/40 text-black text-xs font-bold uppercase tracking-wider border-2 border-white/90 transition-colors"
                style={{ boxShadow: '3px 3px 0 0 rgba(0,0,0,0.85)' }}
              >
                ▶ Build
              </button>
            )}
          </>
        )}
      </div>
      </>)}
    </div>
  );
}
