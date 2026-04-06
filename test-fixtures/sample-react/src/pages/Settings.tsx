import React, { useState } from 'react';
import axios from 'axios';

export default function Settings() {
  const [profile, setProfile] = useState({ name: '', email: '' });

  async function handleSave() {
    await axios.put('/api/settings/profile', profile);
    alert('저장되었습니다');
  }

  async function handleDeleteAccount() {
    if (confirm('정말 삭제하시겠습니까?')) {
      await axios.delete('/api/settings/account');
    }
  }

  return (
    <div className="settings">
      <h1>설정</h1>
      <form onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
        <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
        <input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
        <button type="submit">저장</button>
      </form>
      <button onClick={handleDeleteAccount} className="btn-danger">계정 삭제</button>
    </div>
  );
}
