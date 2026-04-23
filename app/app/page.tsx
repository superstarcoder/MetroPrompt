'use client';

import dynamic from 'next/dynamic';

const CityRenderer = dynamic(() => import('@/components/CityRenderer'), { ssr: false });

export default function Home() {
  return (
    <main className="w-screen h-screen overflow-hidden">
      <CityRenderer />
    </main>
  );
}
