import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  async function handleLogin() {
    const response = await axios.post('/api/auth/login', { email, password });
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
      navigate('/');
    }
  }

  return (
    <div className="login">
      <h1>로그인</h1>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="이메일" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호" />
      <button onClick={handleLogin}>로그인</button>
    </div>
  );
}
