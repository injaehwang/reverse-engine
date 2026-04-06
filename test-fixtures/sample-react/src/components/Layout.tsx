import React from 'react';
import { Link } from 'react-router-dom';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="layout">
      <nav>
        <Link to="/">대시보드</Link>
        <Link to="/settings">설정</Link>
        <Link to="/login">로그인</Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
