'use client';

import dynamic from 'next/dynamic';
import type { CityRendererProps } from '@/components/CityRenderer';

const CityRenderer = dynamic(() => import('@/components/CityRenderer'), { ssr: false });

export default function CityRendererWrapper(props: CityRendererProps = {}) {
  return <CityRenderer {...props} />;
}
