import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Layout from './components/Layout';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
