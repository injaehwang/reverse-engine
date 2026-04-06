import React from 'react';

interface Activity {
  id: string;
  message: string;
  timestamp: string;
}

interface ActivityFeedProps {
  items: Activity[];
}

export default function ActivityFeed({ items }: ActivityFeedProps) {
  return (
    <div className="activity-feed">
      <h2>최근 활동</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.message}</span>
            <time>{item.timestamp}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}
