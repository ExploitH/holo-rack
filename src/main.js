import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import './styles.css'

const Empty = { render: () => null }
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Empty },
    { path: '/server/:id', component: Empty },
    { path: '/:rest(.*)*', redirect: '/' }
  ]
})

createApp(App).use(router).mount('#app')
