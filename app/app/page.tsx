import Link from 'next/link';

export default function Home() {
  return (
    <main className="w-screen h-screen flex items-center justify-center bg-[#0b1220] text-white font-mono overflow-hidden">
      <div className="flex flex-col items-center gap-10 px-6">
        <div className="text-center">
          <div
            className="text-5xl font-bold uppercase tracking-[0.3em] mb-3"
            style={{ textShadow: '4px 4px 0 #1a2540' }}
          >
            MetroPrompt
          </div>
          <div className="text-[11px] uppercase tracking-[0.4em] text-cyan-300/80">
            ▒▒ Agentic City Builder ▒▒
          </div>
        </div>

        <div className="flex flex-col gap-4 w-[22rem]">
          <Link
            href="/build"
            className="block py-4 px-6 bg-cyan-500 hover:bg-cyan-400 text-black text-center text-sm font-bold uppercase tracking-[0.2em] border-2 border-white/90 transition-colors"
            style={{ boxShadow: '4px 4px 0 0 rgba(0,0,0,0.85)', imageRendering: 'pixelated' }}
          >
            ▶ Build New City
          </Link>
          <Link
            href="/cities"
            className="block py-4 px-6 bg-fuchsia-500 hover:bg-fuchsia-400 text-black text-center text-sm font-bold uppercase tracking-[0.2em] border-2 border-white/90 transition-colors"
            style={{ boxShadow: '4px 4px 0 0 rgba(0,0,0,0.85)', imageRendering: 'pixelated' }}
          >
            ▣ My Cities
          </Link>
        </div>
      </div>
    </main>
  );
}
