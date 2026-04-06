import axios from 'axios';

export async function fetchDashboardStats() {
  const response = await axios.get('/api/dashboard/stats');
  return response.data;
}

export async function fetchActivities() {
  const response = await axios.get('/api/dashboard/activities');
  return response.data;
}

export async function createProject(name: string) {
  const response = await axios.post('/api/projects', { name });
  return response.data;
}
