'use client';

import dynamic from 'next/dynamic';

const CityRenderer = dynamic(() => import('@/components/CityRenderer'), { ssr: false });

export default function CityRendererWrapper() {
  return <CityRenderer />;
}
