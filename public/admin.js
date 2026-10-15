const $ = s => document.querySelector(s);
const views = ['#loginView','#deniedView','#dashboardView'];
let allUsers = [], allPlans = [];
const money = n => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(n)||0);
const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function showView(id){views.forEach(v=>$(v).classList.toggle('hidden',v!==id));}
function notice(msg,bad=false){const n=$('#notice');n.textContent=msg;n.classList.remove('hidden','bad');if(bad)n.classList.add('bad');window.scrollTo({top:0,behavior:'smooth'});setTimeout(()=>n.classList.add('hidden'),4500)}
async function api(url,options={}){const token=localStorage.getItem('ledgerly_token');const r=await fetch(url,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(options.headers||{})}});let d={};try{d=await r.json()}catch{}if(r.status===401)localStorage.removeItem('ledgerly_token');if(!r.ok)throw new Error(d.message||`Request failed (${r.status})`);return d}
async function boot(){try{const d=await api('/api/auth/me');if(d.user.role!=='admin'){showView('#deniedView');return}$('#adminIdentity').textContent=`${d.user.name} · ${d.user.email}`;showView('#dashboardView');await loadData()}catch{showView('#loginView')}}
async function loadData(){try{[allUsers,allPlans]=await Promise.all([api('/api/admin/users'),api('/api/admin/plans')]);$('#totalUsers').textContent=allUsers.length;$('#activeUsers').textContent=allUsers.filter(u=>u.subscriptionStatus==='active').length;$('#trialUsers').textContent=allUsers.filter(u=>u.subscriptionStatus==='trial'||u.subscriptionStatus==='none').length;$('#totalPlans').textContent=allPlans.filter(p=>p.active).length;renderUsers();renderPlans()}catch(e){if(/admin access|required|sign in|session/i.test(e.message)){showView('#loginView')}else notice(e.message,true)}}
function renderUsers(){const q=$('#userSearch').value.trim().toLowerCase();const users=allUsers.filter(u=>[u.businessName,u.name,u.email,u.subscriptionPlan].some(x=>String(x||'').toLowerCase().includes(q)));$('#userCount').textContent=`${users.length} account${users.length===1?'':'s'}`;$('#usersBody').innerHTML=users.length?users.map(u=>`<tr><td><strong>${esc(u.businessName||'My Business')}</strong><small>${esc(u.name)} · ${esc(u.email)}</small></td><td>${esc(u.subscriptionPlan||'Free trial')}</td><td>${u.createdAt?new Date(u.createdAt).toLocaleDateString():'—'}</td><td>${u.trialEndsAt?new Date(u.trialEndsAt).toLocaleDateString():'—'}${u.subscriptionStatus==='trial'?`<small>${u.trialExpired?'Expired':`${Number(u.trialDaysRemaining)||0} day(s) left`}</small>`:''}</td><td><select class="status-select" aria-label="Subscription status for ${esc(u.email)}" data-user-id="${esc(u._id)}"><option value="trial" ${u.subscriptionStatus==='trial'?'selected':''}>Trial</option><option value="active" ${u.subscriptionStatus==='active'?'selected':''}>Active</option><option value="past_due" ${u.subscriptionStatus==='past_due'?'selected':''}>Past due</option><option value="cancelled" ${u.subscriptionStatus==='cancelled'?'selected':''}>Cancelled</option><option value="none" ${u.subscriptionStatus==='none'?'selected':''}>No plan</option></select>${u.role!=='admin'?`<button class="plan-toggle" data-extend-trial="${esc(u._id)}">Extend 30 days</button>`:''}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-cell">No matching accounts found.</td></tr>';document.querySelectorAll('[data-user-id]').forEach(el=>el.addEventListener('change',async()=>{try{await api(`/api/admin/users/${encodeURIComponent(el.dataset.userId)}/status`,{method:'PATCH',body:JSON.stringify({subscriptionStatus:el.value})});notice('Subscription status updated.');await loadData()}catch(e){notice(e.message,true);await loadData()}}));document.querySelectorAll('[data-extend-trial]').forEach(el=>el.addEventListener('click',async()=>{if(!confirm('Extend this customer’s trial by 30 days?'))return;el.disabled=true;try{const result=await api(`/api/admin/users/${encodeURIComponent(el.dataset.extendTrial)}/extend-trial`,{method:'POST',body:JSON.stringify({days:30})});notice(result.message||'Trial extended.');await loadData()}catch(e){notice(e.message,true);el.disabled=false}}))}
function renderPlans(){
  $('#plansList').innerHTML=allPlans.length?allPlans.map(p=>`<div class="plan-item"><div><b>${esc(p.name)}</b><small>${esc((p.features||[]).join(' · ')||'No features listed')}</small><span class="plan-state ${p.active?'':'off'}">${p.active?'Visible to customers':'Hidden from customers'}</span></div><div><div class="plan-price">${money(p.price)}<small> / ${esc(p.period||'monthly')}</small></div><button type="button" class="plan-toggle" data-edit-plan="${esc(p._id)}">Edit plan</button><button type="button" class="plan-toggle" data-plan-id="${esc(p._id)}" data-active="${p.active?'true':'false'}">${p.active?'Hide plan':'Publish plan'}</button></div></div>`).join(''):'<div class="empty-cell">No plans configured.</div>';
  document.querySelectorAll('[data-edit-plan]').forEach(b=>b.addEventListener('click',async()=>{
    const plan=allPlans.find(p=>String(p._id)===b.dataset.editPlan);
    if(!plan)return notice('Could not find this plan. Please refresh and try again.',true);
    const name=prompt('Plan name:',plan.name||'');
    if(name===null)return;
    const cleanName=name.trim();
    if(!cleanName||cleanName.length>50)return notice('Enter a plan name between 1 and 50 characters.',true);
    const priceText=prompt('Price in INR:',String(plan.price??''));
    if(priceText===null)return;
    const price=Number(priceText);
    if(!Number.isFinite(price)||price<=0)return notice('Enter a price greater than ₹0.',true);
    const period=prompt('Billing period: enter monthly or yearly',plan.period||'monthly');
    if(period===null)return;
    const cleanPeriod=period.trim().toLowerCase();
    if(!['monthly','yearly'].includes(cleanPeriod))return notice('Billing period must be monthly or yearly.',true);
    const featuresText=prompt('Features, separated by commas:',(plan.features||[]).join(', '));
    if(featuresText===null)return;
    const features=featuresText.split(',').map(x=>x.trim()).filter(Boolean);
    b.disabled=true;
    try{
      await api(`/api/admin/plans/${encodeURIComponent(plan._id)}`,{method:'PATCH',body:JSON.stringify({name:cleanName,price,period:cleanPeriod,features})});
      notice('Plan updated successfully.');
      await loadData();
    }catch(e){notice(e.message,true);b.disabled=false}
  }));
  document.querySelectorAll('[data-plan-id]').forEach(b=>b.addEventListener('click',async()=>{
    try{await api(`/api/admin/plans/${encodeURIComponent(b.dataset.planId)}`,{method:'PATCH',body:JSON.stringify({active:b.dataset.active!=='true'})});notice('Plan visibility updated.');await loadData()}
    catch(e){notice(e.message,true)}
  }));
}
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';const button=e.submitter;button.disabled=true;button.textContent='Signing in…';try{const login=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('#email').value.trim(),password:$('#password').value})});localStorage.setItem('ledgerly_token',login.token);const d=await api('/api/auth/me');if(d.user.role!=='admin'){localStorage.removeItem('ledgerly_token');throw new Error('This account is not an administrator.')}$('#adminIdentity').textContent=`${d.user.name} · ${d.user.email}`;showView('#dashboardView');await loadData()}catch(err){$('#loginError').textContent=err.message||'Could not sign in'}finally{button.disabled=false;button.innerHTML='Sign in to admin <span>→</span>'}});
$('#planForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const payload={name:String(f.get('name')).trim(),price:Number(f.get('price')),period:f.get('period'),features:String(f.get('features')||'').split(',').map(x=>x.trim()).filter(Boolean)};const button=e.submitter;button.disabled=true;try{await api('/api/admin/plans',{method:'POST',body:JSON.stringify(payload)});e.currentTarget.reset();notice('Subscription plan created.');await loadData()}catch(err){notice(err.message,true)}finally{button.disabled=false}});
$('#userSearch').addEventListener('input',renderUsers);$('#reloadBtn').addEventListener('click',loadData);$('#logoutBtn').addEventListener('click',()=>{localStorage.removeItem('ledgerly_token');showView('#loginView');$('#password').value=''});$('#switchAccount').addEventListener('click',()=>{localStorage.removeItem('ledgerly_token');showView('#loginView')});
boot();
