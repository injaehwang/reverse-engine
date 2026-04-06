import React, { useState, useEffect } from 'react';
import StatsCard from '../components/StatsCard';
import ActivityFeed from '../components/ActivityFeed';
import { fetchDashboardStats, fetchActivities } from '../api/dashboard';

interface DashboardProps {
  userId?: string;
}

export default function Dashboard({ userId }: DashboardProps) {
  const [stats, setStats] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [userId]);

  async function loadData() {
    setLoading(true);
    const statsData = await fetchDashboardStats();
    const activityData = await fetchActivities();
    setStats(statsData);
    setActivities(activityData);
    setLoading(false);
  }

  async function handleRefresh() {
    await loadData();
  }

  async function handleExport() {
    const response = await fetch('/api/export', { method: 'POST' });
    const blob = await response.blob();
    console.log('exported', blob);
  }

  if (loading) return <div>로딩 중...</div>;

  return (
    <div className="dashboard">
      <h1>대시보드</h1>
      <button onClick={handleRefresh} className="btn-refresh">새로고침</button>
      <button onClick={handleExport} className="btn-export">내보내기</button>

      <div className="stats-grid">
        <StatsCard title="총 사용자" value={stats?.users} icon="users" />
        <StatsCard title="매출" value={stats?.revenue} icon="dollar" />
        <StatsCard title="주문" value={stats?.orders} icon="cart" />
      </div>

      <ActivityFeed items={activities} />
    </div>
  );
}
