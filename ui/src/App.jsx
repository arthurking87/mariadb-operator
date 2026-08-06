import { useState } from 'react'
import Sidebar from './components/Sidebar'
import GlobalSearch from './components/GlobalSearch'
import Dashboard from './pages/Dashboard'
import CreateMariaDB from './pages/CreateMariaDB'
import InstanceDetail from './pages/InstanceDetail'
import Capacity from './pages/Capacity'
import Switchover from './pages/Switchover'
import Activity from './pages/Activity'
import Docs from './pages/Docs'
import Settings from './pages/Settings'
import './index.css'

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [selectedInstance, setSelectedInstance] = useState(null)

  const navigate = (target, payload) => {
    if (target === 'detail') setSelectedInstance(payload)
    setPage(target)
  }

  const sidebarPage = page === 'detail' || page === 'create' ? 'dashboard' : page

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0d1117' }}>
      <Sidebar page={sidebarPage} setPage={p => navigate(p)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-end px-6 py-3 border-b flex-shrink-0" style={{ borderColor: '#21262d' }}>
          <GlobalSearch navigate={navigate} />
        </div>
        <main className="flex-1 overflow-y-auto">
          {page === 'dashboard' && <Dashboard setPage={navigate} />}
          {page === 'create'    && <CreateMariaDB setPage={navigate} />}
          {page === 'detail'    && <InstanceDetail instanceKey={selectedInstance} setPage={navigate} />}
          {page === 'capacity'  && <Capacity setPage={navigate} />}
          {page === 'switchover' && <Switchover setPage={navigate} />}
          {page === 'activity'  && <Activity />}
          {page === 'docs'      && <Docs />}
          {page === 'settings'  && <Settings />}
        </main>
      </div>
    </div>
  )
}
