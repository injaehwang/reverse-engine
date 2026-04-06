import React from 'react';

interface StatsCardProps {
  title: string;
  value: number;
  icon: string;
}

export default function StatsCard({ title, value, icon }: StatsCardProps) {
  return (
    <div className="stats-card">
      <span className={`icon icon-${icon}`} />
      <h3>{title}</h3>
      <p className="value">{value?.toLocaleString()}</p>
    </div>
  );
}
