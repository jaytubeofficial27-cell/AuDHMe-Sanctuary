var audioCtx = null;
    var sanctuaryNode = null;
    var sanctuaryGain = null;
var bootScreenActive = false;

    function showToast(message) {
      var container = document.getElementById('toast-container');
      if (!container) return;
      var toast = document.createElement('div');
      toast.textContent = message;
      var viewer = document.getElementById('profile-gallery-viewer');
      if (viewer && viewer.open) {
        toast.className = 'gallery-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        viewer.appendChild(toast);
        window.setTimeout(function() { toast.remove(); }, 2800);
        return;
      }
      toast.style.pointerEvents = 'auto';
      toast.style.fontFamily = 'Atkinson Hyperlegible, sans-serif';
      container.appendChild(toast);
      window.setTimeout(function() {
        toast.remove();
      }, 2800);
    }

    let siteConfirmationPending=false;
    function confirmSiteAction(title, message, acceptLabel) {
      const dialog=document.getElementById('site-confirm-dialog');
      if(siteConfirmationPending||dialog.open){showToast('Please finish the current confirmation first.');return Promise.resolve(false);}
      siteConfirmationPending=true;
      document.getElementById('site-confirm-title').textContent=title;
      document.getElementById('site-confirm-message').textContent=message;
      document.getElementById('site-confirm-accept').textContent=acceptLabel;
      return new Promise(function(resolve){
        const cancel=document.getElementById('site-confirm-cancel'),accept=document.getElementById('site-confirm-accept');
        function finish(){dialog.removeEventListener('close',finish);siteConfirmationPending=false;resolve(dialog.returnValue==='accept');}
        dialog.returnValue='';
        dialog.addEventListener('close',finish);
        cancel.onclick=function(){dialog.close('cancel');};
        accept.onclick=function(){dialog.close('accept');};
        dialog.onkeydown=function(event){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dialog.close('cancel');}};
        try {dialog.showModal();cancel.focus();}
        catch(error){dialog.removeEventListener('close',finish);siteConfirmationPending=false;console.error('Confirmation could not be opened:',error);showToast('Confirmation could not be opened. Please try again.');resolve(false);}
      });
    }

    let validationMessageId=0;
    document.addEventListener('invalid',function(event){
      const field=event.target;
      if(!field.form)return;
      event.preventDefault();
      let message=field._siteValidationMessage;
      if(!message){
        message=document.createElement('p');message.className='site-validation-message';message.id='site-validation-'+(++validationMessageId);message.setAttribute('role','alert');
        const composer=field.closest('.gallery-comment-composer');
        if(composer)composer.insertAdjacentElement('afterend',message);else field.insertAdjacentElement('afterend',message);
        field._siteValidationMessage=message;
        const describedBy=(field.getAttribute('aria-describedby')||'').trim();
        field.setAttribute('aria-describedby',(describedBy?describedBy+' ':'')+message.id);
      }
      field.setAttribute('aria-invalid','true');
      message.textContent=field.validationMessage;
      if(field.form.querySelector(':invalid')===field)field.focus();
    },true);
    function clearSiteValidation(field){
      const message=field._siteValidationMessage;
      if(!message)return;
      const ids=(field.getAttribute('aria-describedby')||'').split(/\s+/).filter(function(id){return id&&id!==message.id;});
      if(ids.length)field.setAttribute('aria-describedby',ids.join(' '));else field.removeAttribute('aria-describedby');
      field.removeAttribute('aria-invalid');message.remove();delete field._siteValidationMessage;
    }
    document.addEventListener('input',function(event){
      const field=event.target;
      if(field._siteValidationMessage&&field.validity.valid)clearSiteValidation(field);
    });
    document.addEventListener('reset',function(event){
      Array.from(event.target.elements||[]).forEach(clearSiteValidation);
    },true);

    function copySiteText(text, successMessage) {
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
          showToast(successMessage || 'Copied to clipboard.');
        }).catch(function() {
          fallbackCopySiteText(text, successMessage);
        });
        return;
      }
      fallbackCopySiteText(text, successMessage);
    }

    function fallbackCopySiteText(text, successMessage) {
      var input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      var copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (error) {
        copied = false;
      }
      input.remove();
      showToast(copied ? (successMessage || 'Copied to clipboard.') : 'Could not copy this text. Please select it manually.');
    }

    function getAudioContext() {
      if (!audioCtx) {
        var AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) audioCtx = new AudioContextClass();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    }

    function playTactileClick(freq, duration) {
      var chk = document.getElementById('chk-ui-sound');
      var bootSoundAllowed = bootScreenActive && !document.body.classList.contains('low-input-active');
      var globalSoundAllowed = chk && chk.checked;
      if (!bootSoundAllowed && !globalSoundAllowed) return;
      if (document.body.classList.contains('low-input-active')) return;
      try {
        var ctx = getAudioContext();
        if (!ctx) return;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq || 260, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + (duration || 0.045));
        gain.gain.setValueAtTime(0.035, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (duration || 0.045));
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + (duration || 0.045));
      } catch (e) {}
    }

    function popStimButton(btn, freq) {
      btn.classList.toggle('popped');
      playTactileClick(freq, 0.075);
    }

    function triggerCalmHarmonic() {
      var pills = document.querySelectorAll('#boot-stim-grid .stim-pill');
      pills.forEach(function(p, idx) {
        setTimeout(function() { p.classList.toggle('popped'); }, idx * 45);
      });
      playTactileClick(392, 0.12);
    }

    var bootProgress = 0;
    var bootInterval = null;
    var bootPaused = false;
    var groundingDurationMs = 18000;

    function getPersonalizedBootGreeting() {
      var hour = new Date().getHours();
      var timeOfDay = hour >= 6 && hour < 12 ? 'morning'
        : hour >= 12 && hour < 17 ? 'afternoon'
        : hour >= 17 && hour < 21 ? 'evening'
        : 'night';

      var greetings = {
        morning: {
          heading: 'Good morning. Take this moment gently.',
          message: 'Ease into the day here. No need to rush, explain yourself, or have everything figured out before you begin.'
        },
        afternoon: {
          heading: 'Good afternoon. Set down what you have been carrying.',
          message: 'Take a quiet pause in the middle of the day. You can return to things when you feel ready, one small step at a time.'
        },
        evening: {
          heading: 'Good evening. Let the day loosen its hold.',
          message: 'You made it through more than you may realise. Rest your shoulders and settle in without needing to earn your place.'
        },
        night: {
          heading: 'Welcome to the quiet hours.',
          message: 'The world is quieter now, and nothing here needs to be hurried. Take a slow breath and arrive at your own pace.'
        }
      };

      return greetings[timeOfDay];
    }

    function applyPersonalizedBootGreeting() {
      var greeting = getPersonalizedBootGreeting();
      var heading = document.getElementById('boot-personal-heading');
      var status = document.getElementById('boot-status-line');
      if (heading) heading.textContent = greeting.heading;
      if (status) status.textContent = greeting.message;
    }

    function startGroundingBoot() {
      var overlay = document.getElementById('os-boot-overlay');
      var fill = document.getElementById('boot-bar-fill');
      var pct = document.getElementById('boot-pct-label');
      var phase = document.getElementById('boot-phase-text');
      if (!overlay) return;

      bootScreenActive = true;
      applyPersonalizedBootGreeting();
      overlay.classList.remove('boot-complete');
      overlay.classList.remove('boot-paused');
      bootProgress = 0;
      bootPaused = false;
      if (bootInterval) clearInterval(bootInterval);

      bootInterval = setInterval(function() {
        if (bootPaused) return;
        bootProgress += 100 * 50 / groundingDurationMs;
        if (bootProgress > 100) bootProgress = 100;

        var r = Math.floor(bootProgress);
        if (fill) fill.style.width = r + '%';
        if (pct) pct.textContent = r + '%';

        if (phase) {
          if (r < 35) phase.textContent = 'Breathe in slowly as the circle expands...';
          else if (r < 70) phase.textContent = 'Hold gently... no rush, no pressure.';
          else phase.textContent = 'Breathe out slowly... entering sanctuary.';
        }

        if (bootProgress >= 100) {
          clearInterval(bootInterval);
          setTimeout(dismissBootSequence, 300);
        }
      }, 50);
    }

    function toggleBootPause() {
      bootPaused = !bootPaused;
      var overlay = document.getElementById('os-boot-overlay');
      if (overlay) overlay.classList.toggle('boot-paused', bootPaused);
      var btn = document.getElementById('boot-pause-btn');
      if (btn) {
        btn.textContent = bootPaused ? '▶ RESUME AUTO-ENTRY' : '⏸ STAY & BREATHE LONGER';
      }
      playTactileClick(bootPaused ? 240 : 360, 0.06);
    }

    function dismissBootSequence() {
      if (bootInterval) clearInterval(bootInterval);
      var overlay = document.getElementById('os-boot-overlay');
      playTactileClick(440, 0.08);
      bootScreenActive = false;
      if (overlay) overlay.classList.add('boot-complete');
    }

    function replayGroundingBoot() {
      var widget = document.getElementById('audhme-widget-wrapper');
      if (widget) widget.classList.remove('panel-open');
      startGroundingBoot();
    }

    var currentPageKey = 'home';
    var pageSwitchLock = false;

    function setStoreCatalogView() {
      var catalog = document.getElementById('store-catalog');
      if (catalog) catalog.hidden = false;
      document.querySelectorAll('.store-product-detail').forEach(function(detail) {
        detail.hidden = true;
      });
    }

    function setStoreProductView(productKey) {
      var catalog = document.getElementById('store-catalog');
      var detail = document.getElementById('store-detail-' + productKey);
      if (!catalog || !detail) return false;
      catalog.hidden = true;
      document.querySelectorAll('.store-product-detail').forEach(function(productDetail) {
        productDetail.hidden = productDetail !== detail;
      });
      window.scrollTo({ top: 0, behavior: 'instant' });
      return true;
    }

    function showStoreProduct(productKey, updateHistory) {
      if (!document.getElementById('store-detail-' + productKey)) return;
      switchPage('store', false);
      setStoreProductView(productKey);
      if (updateHistory !== false) {
        try { history.pushState(null, null, '#store/' + productKey); } catch (e) { window.location.hash = 'store/' + productKey; }
      }
    }

    function showStoreCatalog(updateHistory) {
      switchPage('store', false);
      setStoreCatalogView();
      if (updateHistory !== false) {
        try { history.pushState(null, null, '#store'); } catch (e) { window.location.hash = 'store'; }
      }
    }

    window.updateSpectrumHoodiePreview = function(color) {
      var image = document.getElementById('spectrum-hoodie-preview');
      if (!image) return;
      var previews = {
        Black: 'https://www.image2url.com/r2/default/files/1781708814875-2d29dc18-e51e-4b59-ab22-18b8abf64ca4.png',
        White: 'https://www.image2url.com/r2/default/files/1781708839989-e77e976e-6eeb-41c1-83fa-867dcf360c80.png'
      };
      if (!previews[color]) return;
      image.src = previews[color];
      image.alt = 'The Spectrum Hoodie in ' + color;
    };

    function toggleMobileMenu() {
      var links = document.querySelector('.audh-links');
      if (links) {
        const isOpen = links.classList.toggle('active');
        const button = document.querySelector('.audh-hamburger');
        if (button) button.setAttribute('aria-expanded', String(isOpen));
      }
    }

    function toggleNavGroup(button) {
      const parent = button && button.closest('.group');
      if (!parent) return;
      parent.classList.remove('dismissed');
      const opening = !parent.classList.contains('open');
      document.querySelectorAll('.audh-links .group.open').forEach(function(group) {
        group.classList.remove('open');
        const trigger = group.querySelector('[aria-haspopup="true"]');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      });
      if (opening) parent.classList.add('open');
      button.setAttribute('aria-expanded', String(opening));
    }

    function closeNavGroup(link) {
      const parent = link && link.closest('.group');
      if (!parent) return;
      parent.classList.remove('open');
      parent.classList.add('dismissed');
      const trigger = parent.querySelector('[aria-haspopup="true"]');
      if (trigger) {
        trigger.setAttribute('aria-expanded', 'false');
        trigger.focus();
      }
    }

    document.querySelectorAll('.audh-links .group').forEach(function(group) {
      group.addEventListener('pointerenter', function() {
        group.classList.remove('dismissed');
      });
      group.addEventListener('pointerleave', function() {
        if (!group.contains(document.activeElement)) group.classList.remove('dismissed');
      });
      group.addEventListener('focusout', function(event) {
        if (!group.contains(event.relatedTarget)) group.classList.remove('dismissed');
      });
    });

    function closeMobileNav() {
      var links = document.querySelector('.audh-links');
      if (links) links.classList.remove('active');
      var button = document.querySelector('.audh-hamburger');
      if (button) button.setAttribute('aria-expanded', 'false');
      document.querySelectorAll('.audh-links .group.open').forEach(function(group) {
        group.classList.remove('open');
        var trigger = group.querySelector('[aria-haspopup="true"]');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      });
    }
    document.addEventListener('click', function(event) {
      var links = document.querySelector('.audh-links');
      if (!links || !links.classList.contains('active')) return;
      var hamburger = document.querySelector('.audh-hamburger');
      if (links.contains(event.target) || (hamburger && hamburger.contains(event.target))) return;
      closeMobileNav();
    });
    document.addEventListener('keydown', function(event) {
      if (event.key !== 'Escape') return;
      var links = document.querySelector('.audh-links');
      if (links && links.classList.contains('active')) {
        closeMobileNav();
        var hamburger = document.querySelector('.audh-hamburger');
        if (hamburger) hamburger.focus();
      }
    });

    function updateSkipTarget(targetId) {
      var skipLink = document.querySelector('.skip-link');
      var target = document.getElementById(targetId);
      if (!skipLink || !target) return;
      target.tabIndex = -1;
      skipLink.href = '#' + targetId;
    }

    function updateActiveNavigation(pageKey) {
      document.querySelectorAll('.nav-item').forEach(function(item) {
        item.classList.toggle('active', item.getAttribute('data-target') === pageKey);
      });
      document.querySelectorAll('.audh-links .group').forEach(function(group) {
        var trigger = group.querySelector(':scope > button');
        if (trigger) trigger.classList.toggle('active', Boolean(group.querySelector('[data-target="' + pageKey + '"]')));
      });
    }

    var routeVersion = 0;
    function hideRouteLoading() {
      document.getElementById('route-loading').classList.add('hidden');
    }

    function showRouteLoading(hash) {
      document.querySelectorAll('.active-embed').forEach(function(element) {
        element.classList.remove('active-embed');
      });
      ['profile-page', 'directory-view', 'confessions-view'].forEach(function(id) {
        var element = document.getElementById(id);
        element.classList.add('hidden');
        element.style.display = 'none';
      });
      var loading = document.getElementById('route-loading');
      var message = document.getElementById('route-loading-message');
      message.setAttribute('role', 'status');
      message.textContent = hash === 'directory' ? 'Loading community directory…' : (hash === 'confessions' ? 'Loading confessions…' : 'Loading profile…');
      loading.classList.remove('hidden');
      updateSkipTarget('route-loading');
      updateActiveNavigation(hash === 'directory' ? 'directory' : 'profile');
    }

    function switchPage(pageKey, updateHistory) {
      playTactileClick(310, 0.04);
      closeGalleryViewer();
      closeProfileStatusForNavigation();
      routeVersion++;
      hideRouteLoading();

      var allEmbeds = ['embed03', 'embed35', 'embed-store', 'embed13', 'embed09', 'embed41', 'embed07', 'embed06', 'embed11', 'embed04', 'embed15', 'embed16'];
      var targetEmbeds = [];

      if (pageKey === 'home') targetEmbeds = ['embed03'];
      else if (pageKey === 'neuroverse') targetEmbeds = ['embed35'];
      else if (pageKey === 'store') targetEmbeds = ['embed-store'];
      else if (pageKey === 'petition') targetEmbeds = ['embed13'];
      else if (pageKey === 'neuropedia') {
        targetEmbeds = (currentNeuropediaMode === 'conditions') ? ['embed09'] : ['embed09', 'embed41', 'embed07'];
      }
      else if (pageKey === 'toolkit') targetEmbeds = ['embed15'];
      else if (pageKey === 'civic') targetEmbeds = ['embed06'];
      else if (pageKey === 'build') targetEmbeds = ['embed11'];
      else if (pageKey === 'creator') targetEmbeds = ['embed04'];
      else if (pageKey === 'legal') targetEmbeds = ['embed16'];
      if (pageKey === 'store') setStoreCatalogView();
      if (targetEmbeds.length) updateSkipTarget(targetEmbeds[0]);

      const profilePage = document.getElementById('profile-page');
      const directoryView = document.getElementById('directory-view');
      if (profilePage) { profilePage.classList.add('hidden'); profilePage.classList.remove('active-embed'); profilePage.style.display = 'none'; }
      if (directoryView) { directoryView.classList.add('hidden'); directoryView.classList.remove('active-embed'); directoryView.style.display = 'none'; }
      var confessionsViewSp=document.getElementById('confessions-view'); if(confessionsViewSp){confessionsViewSp.classList.add('hidden');confessionsViewSp.classList.remove('active-embed');confessionsViewSp.style.display='none';}

      updateActiveNavigation(pageKey);

      var links = document.querySelector('.audh-links');
      if (links) links.classList.remove('active');
      var menuButton = document.querySelector('.audh-hamburger');
      if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
      document.querySelectorAll('.audh-links .group.open').forEach(function(group) {
        group.classList.remove('open');
        var trigger = group.querySelector('[aria-haspopup="true"]');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      });

      allEmbeds.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.classList.remove('active-embed');
      });

      targetEmbeds.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.classList.add('active-embed');
      });
      if (updateHistory) {
        try { history.pushState(null, null, '#' + pageKey); } catch (e) { window.location.hash = pageKey; }
      }

      window.scrollTo({ top: 0, behavior: 'instant' });
      currentPageKey = pageKey;
    }

    function handleInitialRoute() {
      var rawHash = window.location.hash.replace('#', '');
      var hash = rawHash.toLowerCase();
      var isMemberRoute = rawHash.slice(0,7).toLowerCase() === 'member/';
      if (isMemberRoute || hash === 'profile' || hash === 'directory' || hash === 'confessions') {
        var pendingVersion = ++routeVersion;
        var routeUserId;
        showRouteLoading(hash);
        authInitialized.then(function() {
          if (pendingVersion !== routeVersion) return;
          if (!auth.currentUser) {
            switchPage('home', false);
            openAuthModal('signup');
            return;
          }
          routeUserId = auth.currentUser.uid;
          if (hash === 'profile') return userProfileReady;
        }).then(function() {
          if (pendingVersion !== routeVersion) return;
          if (!auth.currentUser || auth.currentUser.uid !== routeUserId) {
            handleInitialRoute();
            return;
          }
          if (isMemberRoute) {
            var uid;
            try { uid = decodeURIComponent(rawHash.slice(7)); } catch (e) { uid = rawHash.slice(7); }
            return openCommunityProfile(uid, false, pendingVersion).then(function(opened) {
              if (!opened && pendingVersion === routeVersion) {
                var message = document.getElementById('route-loading-message');
                message.setAttribute('role', 'alert');
                message.textContent = 'This profile is private or unavailable. Use the navigation to choose another page.';
              }
            });
          }
          switchView(hash, false);
        }).catch(function(error) {
          if (pendingVersion !== routeVersion) return;
          console.error('Page loading failed:', error.code || error.message);
          var message = document.getElementById('route-loading-message');
          message.setAttribute('role', 'alert');
          message.textContent = 'This page could not be loaded. Please try refreshing or choose another page.';
        });
        return;
      }
      var storeRoute = hash.match(/^store\/(core-hoodie|spectrum-hoodie)$/);
      if (storeRoute) {
        switchPage('store', false);
        setStoreProductView(storeRoute[1]);
        return;
      }
      var validPages = ['home', 'neuropedia', 'toolkit', 'build', 'petition', 'neuroverse', 'civic', 'creator', 'store', 'legal'];
      var initialPage = validPages.includes(hash) ? hash : 'home';
      switchPage(initialPage, false);
    }

    window.addEventListener('popstate', handleInitialRoute);
    window.addEventListener('hashchange', handleInitialRoute);

    var neuroCodeAdaptations = Object.create(null);
    var activeNeuroCodeAdaptation = null;
    var pendingNeuroCodeAdaptation = null;
    var neuroCodeAdaptationReturnFocus = null;

    function groupCardLabel(card) {
      var code = card.querySelector(':scope > .card-code-badge');
      var title = card.querySelector(':scope > .card-title');
      if (!code || !title) return;
      var label = document.createElement('span');
      label.className = 'card-label-group';
      code.before(label);
      label.append(code, title);
    }

    function enhanceAllFlipCards() {
      document.querySelectorAll('.flip-card').forEach(function(card) {
        if (card.dataset.neuroCodeEnhanced === 'true') return;
        var front = card.querySelector('.flip-card-front');
        if (front) groupCardLabel(front);
        card.dataset.neuroCodeEnhanced = 'true';
        card.tabIndex = 0;
        card.setAttribute('role', 'group');
        card.addEventListener('click', function(event) {
          if (event.target.closest('button')) return;
          var isFlipped = card.classList.contains('flipped');
          card.setAttribute('aria-label', code + ', ' + title + (isFlipped ? '. Code details shown.' : '. Press Enter or Space to reveal code details.'));
          playTactileClick(isFlipped ? 230 : 350, 0.045);
        });
        card.addEventListener('keydown', function(event) {
          if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
            event.preventDefault();
            card.click();
          }
        });

        var back = card.querySelector('.flip-card-back');
        if (!back || back.querySelector('.card-action-bar')) return;

        var codeEl = back.querySelector('.card-code-mini');
        var titleEl = back.querySelector('.card-title-mini');
        var descEl = back.querySelector('.card-desc');
        var code = codeEl ? codeEl.textContent.trim() : 'NC-00';
        var title = titleEl ? titleEl.textContent.trim() : 'Neuro-Code';
        var desc = descEl ? descEl.textContent.trim() : '';
        card.dataset.neuroCode = code;
        card.setAttribute('aria-label', code + ', ' + title + '. Press Enter or Space to reveal the code.');

        var bar = document.createElement('div');
        bar.className = 'card-action-bar';

        var pinBtn = document.createElement('button');
        pinBtn.className = 'pin-code-btn';
        pinBtn.type = 'button';
        pinBtn.textContent = 'PIN TO TOP';
        pinBtn.onclick = function(event) {
          event.stopPropagation();
          togglePinCode(code, title, pinBtn);
        };

        var hudBtn = document.createElement('button');
        hudBtn.className = 'hud-pass-btn';
        hudBtn.type = 'button';
        hudBtn.textContent = 'OPEN PASS';
        hudBtn.onclick = function(event) {
          event.stopPropagation();
          openCrisisHud(code, title, desc);
        };

        var adaptBtn = document.createElement('button');
        adaptBtn.className = 'adapt-site-btn';
        adaptBtn.type = 'button';
        adaptBtn.textContent = 'ADAPT SITE';
        adaptBtn.setAttribute('aria-label', 'Choose temporary site preferences for ' + code + ', ' + title);
        adaptBtn.onclick = function(event) {
          event.stopPropagation();
          openNeuroCodeAdaptation(code, title, desc, adaptBtn);
        };

        bar.appendChild(pinBtn);
        bar.appendChild(hudBtn);
        bar.appendChild(adaptBtn);
        back.appendChild(bar);
      });
    }

    function openCrisisHud(code, title, desc) {
      playTactileClick(420, 0.07);
      activeCrisisPass = { code: code, title: title, desc: desc };
      document.getElementById('hud-modal-code').textContent = code + ' · ACTIVE ADVOCACY PASS';
      document.getElementById('hud-modal-title').textContent = title;
      document.getElementById('hud-modal-desc').textContent = desc;
      document.getElementById('crisis-hud-modal').classList.add('hud-active');
    }

    function closeCrisisHud() {
      playTactileClick(220, 0.05);
      document.getElementById('crisis-hud-modal').classList.remove('hud-active');
    }

    function togglePassNeed(button) {
      var active = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('ring-2', active);
      button.classList.toggle('ring-[#cbb678]', active);
      button.classList.toggle('bg-[#cbb678]/20', active);
    }

    var activeCrisisPass = null;

    var neuroCodeAdaptationOptionCatalog = {
      quiet: { label: 'Quiet the screen', description: 'Remove the textured background and flatten decorative card surfaces.', className: 'site-adapt-calm' },
      still: { label: 'Pause interface motion', description: 'Stop card flips and page transitions from animating.', className: 'site-adapt-motion' },
      reading: { label: 'Add reading space', description: 'Increase text size, line height, and spacing throughout the page.', className: 'site-adapt-reading' },
      focus: { label: 'Highlight this code', description: 'Keep this card open and visibly marked without hiding other content.', className: 'site-highlight-code' },
      series: { label: 'Show only this code series', description: 'Hide other Neuro-Code series until you restore the full collection.', className: 'site-series-focus' },
      targets: { label: 'Enlarge interaction targets', description: 'Make buttons and controls larger and easier to select.', className: 'site-large-controls' },
      column: { label: 'Use a single-column layout', description: 'Stack cards and resource panels instead of showing side-by-side choices.', className: 'site-single-column' },
      message: { label: 'Keep the need statement visible', description: 'Pin the full code description above the page content.', className: 'site-show-message' },
      copy: { label: 'Add a copy-message button', description: 'Add a button to copy this code’s statement for sharing or showing someone.', className: 'site-copy-message' },
      sensory: { label: 'Highlight sensory controls', description: 'Bring attention to the sensory tools so you can choose what helps.', className: 'site-sensory-controls' },
      step: { label: 'Open a one-step task prompt', description: 'Add a small, temporary field to write one next step without making a checklist.', className: 'site-next-step' },
      timer: { label: 'Open a body-doubling timer', description: 'Add an optional quiet focus timer. It does not start until you press Start.', className: 'site-focus-timer' }
    };

    var neuroCodeAdaptationOptionsByCode = {
      'NC-01': ['message', 'copy'],
      'NC-02': ['timer', 'message'],
      'NC-10': ['quiet', 'still', 'series', 'message'],
      'NC-11': ['sensory', 'message'],
      'NC-12': ['quiet', 'still', 'reading', 'series'],
      'NC-13': ['targets', 'message'],
      'NC-14': ['quiet', 'column', 'series'],
      'NC-15': ['message', 'copy'],
      'NC-16': ['quiet', 'column', 'reading', 'series'],
      'NC-17': ['reading', 'message'],
      'NC-18': ['quiet', 'still', 'message'],
      'NC-19': ['reading', 'message', 'copy'],
      'NC-20': ['reading', 'message'],
      'NC-21': ['quiet', 'reading', 'series'],
      'NC-22': ['reading', 'focus'],
      'NC-23': ['timer', 'focus'],
      'NC-24': ['step', 'timer', 'series'],
      'NC-25': ['reading', 'message', 'copy'],
      'NC-26': ['column', 'series'],
      'NC-27': ['message', 'reading'],
      'NC-30': ['quiet', 'still', 'message'],
      'NC-31': ['message', 'copy', 'reading'],
      'NC-32': ['message', 'copy', 'reading'],
      'NC-33': ['message', 'copy'],
      'NC-34': ['quiet', 'still', 'message'],
      'NC-35': ['reading', 'message'],
      'NC-36': ['still', 'step', 'message'],
      'NC-37': ['sensory', 'message'],
      'NC-40': ['reading', 'message'],
      'NC-41': ['step', 'timer', 'series'],
      'NC-42': ['timer', 'message'],
      'NC-43': ['quiet', 'still', 'reading'],
      'NC-44': ['message', 'copy'],
      'NC-45': ['still', 'step'],
      'NC-46': ['reading', 'message'],
      'NC-47': ['step', 'timer'],
      'NC-48': ['column', 'step', 'series'],
      'NC-50': ['quiet', 'still', 'message', 'series'],
      'NC-51': ['quiet', 'still', 'message'],
      'NC-52': ['quiet', 'still', 'message'],
      'NC-53': ['targets', 'message', 'copy'],
      'NC-54': ['quiet', 'still', 'message'],
      'NC-55': ['message', 'copy', 'targets'],
      'NC-56': ['message', 'copy', 'still'],
      'NC-57': ['reading', 'message'],
      'NC-58': ['step', 'message'],
      'NC-59': ['reading', 'message', 'copy', 'targets'],
      'NC-60': ['step', 'timer', 'reading'],
      'NC-61': ['column', 'message'],
      'NC-62': ['timer', 'message'],
      'NC-63': ['sensory', 'message'],
      'NC-64': ['quiet', 'still', 'reading', 'series']
    };

    function suggestNeuroCodeAdaptation(code) {
      var options = neuroCodeAdaptationOptionsByCode[code] || [];
      var optionNames = options.map(function(optionKey) {
        return neuroCodeAdaptationOptionCatalog[optionKey].label;
      });
      return {
        options: options,
        guidance: optionNames.length
          ? 'These suggestions are specific to this code: ' + optionNames.join(', ') + '. They are optional; keep only what fits right now.'
          : 'No site actions are defined for this code. Its original communication card and Neuro-Pass remain available.'
      };
    }

    function setNeuroCodeAdaptationFields(selectedOptions, guidance) {
      var list = document.getElementById('adaptation-options-list');
      list.replaceChildren();
      var availableOptions = neuroCodeAdaptationOptionsByCode[pendingNeuroCodeAdaptation.code] || ['focus', 'message'];
      availableOptions.forEach(function(optionKey) {
        var option = neuroCodeAdaptationOptionCatalog[optionKey];
        if (!option) return;
        var label = document.createElement('label');
        label.className = 'adaptation-option';
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.id = 'adapt-' + pendingNeuroCodeAdaptation.code.toLowerCase() + '-' + optionKey;
        input.value = optionKey;
        input.checked = selectedOptions.indexOf(optionKey) !== -1;
        input.setAttribute('data-adaptation-option', optionKey);
        input.onchange = updateAdaptationPreview;
        var copy = document.createElement('span');
        var title = document.createElement('strong');
        title.textContent = option.label;
        var detail = document.createElement('small');
        detail.textContent = option.description;
        copy.appendChild(title);
        copy.appendChild(detail);
        label.appendChild(input);
        label.appendChild(copy);
        list.appendChild(label);
      });
      document.getElementById('adaptation-options-legend').textContent = availableOptions.length
        ? 'Site changes for this code'
        : 'No site changes are defined for this code';
      document.getElementById('adaptation-code-guidance').textContent = guidance;
      updateAdaptationPreview();
    }

    function updateAdaptationPreview() {
      var selected = document.querySelectorAll('#adaptation-options-list input:checked').length;
      var status = selected === 0
        ? 'No site changes selected. The current site will stay as it is.'
        : selected + ' site change' + (selected === 1 ? '' : 's') + ' selected. Nothing changes until you apply.';
      document.getElementById('adaptation-preview-status').textContent = status;
    }

    function openNeuroCodeAdaptation(code, title, desc, opener) {
      pendingNeuroCodeAdaptation = { code: code, title: title, desc: desc };
      neuroCodeAdaptationReturnFocus = opener || document.activeElement;
      document.getElementById('adaptation-code-label').textContent = code;
      document.getElementById('adaptation-code-title').textContent = title;
      document.getElementById('adaptation-code-description').textContent = desc;
      var profile = suggestNeuroCodeAdaptation(code);
      setNeuroCodeAdaptationFields(
        neuroCodeAdaptations[code] || profile.options,
        neuroCodeAdaptations[code] ? 'Your previous choices for this code are selected. Edit them for what would help right now.' : profile.guidance
      );
      var modal = document.getElementById('site-adaptation-modal');
      modal.hidden = false;
      document.body.classList.add('adaptation-dialog-open');
      var firstOption = modal.querySelector('#adaptation-options-list input');
      (firstOption || modal.querySelector('.adaptation-close')).focus();
    }

    function closeNeuroCodeAdaptation(restoreFocus) {
      var modal = document.getElementById('site-adaptation-modal');
      if (modal) modal.hidden = true;
      document.body.classList.remove('adaptation-dialog-open');
      pendingNeuroCodeAdaptation = null;
      if (restoreFocus !== false && neuroCodeAdaptationReturnFocus && document.contains(neuroCodeAdaptationReturnFocus)) {
        neuroCodeAdaptationReturnFocus.focus();
      }
      neuroCodeAdaptationReturnFocus = null;
    }

    function applyNeuroCodeAdaptation() {
      if (!pendingNeuroCodeAdaptation) return;
      var selectedOptions = Array.from(document.querySelectorAll('#adaptation-options-list input:checked')).map(function(input) {
        return input.getAttribute('data-adaptation-option');
      });
      restoreActiveNeuroCodeCard();
      var codeCard = document.querySelector('.flip-card[data-neuro-code="' + pendingNeuroCodeAdaptation.code + '"]');
      var adaptation = {
        code: pendingNeuroCodeAdaptation.code,
        title: pendingNeuroCodeAdaptation.title,
        desc: pendingNeuroCodeAdaptation.desc,
        options: selectedOptions,
        cardWasFlipped: Boolean(codeCard && codeCard.classList.contains('flipped'))
      };
      neuroCodeAdaptations[adaptation.code] = selectedOptions.slice();
      activeNeuroCodeAdaptation = adaptation;

      Object.keys(neuroCodeAdaptationOptionCatalog).forEach(function(optionKey) {
        var className = neuroCodeAdaptationOptionCatalog[optionKey].className;
        if (className) document.body.classList.toggle(className, selectedOptions.indexOf(optionKey) !== -1);
      });
      document.querySelectorAll('.flip-card.site-active-neuro-code').forEach(function(card) {
        card.classList.remove('site-active-neuro-code');
      });
      document.querySelectorAll('.series-block-container.site-active-code-series').forEach(function(series) {
        series.classList.remove('site-active-code-series');
      });

      if (selectedOptions.indexOf('focus') !== -1 || selectedOptions.indexOf('series') !== -1) {
        if (codeCard) {
          codeCard.classList.add('site-active-neuro-code', 'flipped');
          var series = codeCard.closest('.series-block-container');
          if (series) series.classList.add('site-active-code-series');
        }
      }

      var banner = document.getElementById('active-site-adaptation');
      document.getElementById('active-site-adaptation-title').textContent = adaptation.code + ' · ' + adaptation.title + ' - site adapted';
      var activeChanges = selectedOptions.map(function(optionKey) {
        return neuroCodeAdaptationOptionCatalog[optionKey].label.toLowerCase();
      });
      document.getElementById('active-site-adaptation-description').textContent = activeChanges.length
        ? activeChanges.join(' · ')
        : 'No site changes selected; this code is active for reference only.';
      updateActiveNeuroCodeTools(adaptation);
      banner.hidden = false;
      closeNeuroCodeAdaptation(false);
      banner.querySelector('.active-site-adaptation-actions button').focus();
    }

    function updateActiveNeuroCodeTools(adaptation) {
      var options = adaptation.options;
      var needMessage = document.getElementById('active-site-need-message');
      needMessage.hidden = options.indexOf('message') === -1 && options.indexOf('copy') === -1;
      document.getElementById('active-site-need-text').textContent = adaptation.desc;
      document.getElementById('copy-active-site-need').hidden = options.indexOf('copy') === -1;
      document.getElementById('active-site-next-step').hidden = options.indexOf('step') === -1;
      document.getElementById('active-site-focus-timer').hidden = options.indexOf('timer') === -1;
      if (options.indexOf('step') !== -1) {
        document.getElementById('active-site-next-step-input').value = '';
        document.getElementById('active-site-next-step-status').textContent = '';
      }
      if (options.indexOf('timer') !== -1) resetNeuroCodeFocusTimer();
      else clearNeuroCodeFocusTimer();
      if (options.indexOf('sensory') !== -1) {
        document.getElementById('audhme-widget-wrapper').classList.add('site-sensory-tools-highlight');
      } else {
        document.getElementById('audhme-widget-wrapper').classList.remove('site-sensory-tools-highlight');
      }
    }

    function restoreActiveNeuroCodeCard() {
      if (!activeNeuroCodeAdaptation ||
          (activeNeuroCodeAdaptation.options.indexOf('focus') === -1 && activeNeuroCodeAdaptation.options.indexOf('series') === -1) ||
          activeNeuroCodeAdaptation.cardWasFlipped) return;
      var card = document.querySelector('.flip-card[data-neuro-code="' + activeNeuroCodeAdaptation.code + '"]');
      if (!card) return;
      card.classList.remove('flipped');
      card.setAttribute('aria-label', activeNeuroCodeAdaptation.code + ', ' + activeNeuroCodeAdaptation.title + '. Press Enter or Space to reveal code details.');
    }

    function resetNeuroCodeAdaptation() {
      restoreActiveNeuroCodeCard();
      activeNeuroCodeAdaptation = null;
      Object.keys(neuroCodeAdaptationOptionCatalog).forEach(function(optionKey) {
        var className = neuroCodeAdaptationOptionCatalog[optionKey].className;
        if (className) document.body.classList.remove(className);
      });
      document.querySelectorAll('.flip-card.site-active-neuro-code').forEach(function(card) {
        card.classList.remove('site-active-neuro-code');
      });
      document.querySelectorAll('.series-block-container.site-active-code-series').forEach(function(series) {
        series.classList.remove('site-active-code-series');
      });
      document.getElementById('active-site-need-message').hidden = true;
      document.getElementById('active-site-next-step').hidden = true;
      document.getElementById('active-site-focus-timer').hidden = true;
      document.getElementById('audhme-widget-wrapper').classList.remove('site-sensory-tools-highlight');
      clearNeuroCodeFocusTimer();
      document.getElementById('active-site-adaptation').hidden = true;
    }

    function copyActiveNeuroCodeMessage() {
      if (!isFounderCopyExempt()) { showToast('Copying is disabled for this account.'); return; }
      if (!activeNeuroCodeAdaptation) return;
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        showToast('Copy is not available in this browser. You can select the need statement instead.');
        return;
      }
      navigator.clipboard.writeText(activeNeuroCodeAdaptation.desc).then(function() {
        showToast('Need statement copied.');
      }).catch(function(error) {
        console.error('Could not copy Neuro-Code statement:', error);
        showToast('Could not copy the statement. Select the text to share it instead.');
      });
    }

    function saveNeuroCodeNextStep() {
      var input = document.getElementById('active-site-next-step-input');
      var status = document.getElementById('active-site-next-step-status');
      if (!input.value.trim()) {
        status.textContent = 'Add one small step first.';
        input.focus();
        return;
      }
      status.textContent = 'Step saved for this page: ' + input.value.trim();
    }

    var neuroCodeTimerInterval = null;
    var neuroCodeTimerSeconds = 20 * 60;

    function resetNeuroCodeFocusTimer() {
      clearNeuroCodeFocusTimer();
      neuroCodeTimerSeconds = 20 * 60;
      document.getElementById('active-site-focus-timer-status').textContent = '20:00 · ready when you are';
      document.getElementById('active-site-focus-timer-button').textContent = 'Start 20 minutes';
    }

    function clearNeuroCodeFocusTimer() {
      if (neuroCodeTimerInterval !== null) {
        window.clearInterval(neuroCodeTimerInterval);
        neuroCodeTimerInterval = null;
      }
    }

    function toggleNeuroCodeFocusTimer() {
      var status = document.getElementById('active-site-focus-timer-status');
      var button = document.getElementById('active-site-focus-timer-button');
      if (neuroCodeTimerInterval !== null) {
        clearNeuroCodeFocusTimer();
        button.textContent = 'Resume timer';
        status.textContent += ' · paused';
        return;
      }
      button.textContent = 'Pause timer';
      neuroCodeTimerInterval = window.setInterval(function() {
        neuroCodeTimerSeconds = Math.max(0, neuroCodeTimerSeconds - 1);
        var minutes = Math.floor(neuroCodeTimerSeconds / 60);
        var seconds = neuroCodeTimerSeconds % 60;
        status.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
        if (neuroCodeTimerSeconds === 0) {
          clearNeuroCodeFocusTimer();
          status.textContent = 'Timer complete. Take a break or continue if you want.';
          button.textContent = 'Start again';
          neuroCodeTimerSeconds = 20 * 60;
        }
      }, 1000);
    }

    function editActiveNeuroCodeAdaptation() {
      if (!activeNeuroCodeAdaptation) return;
      var adaptation = activeNeuroCodeAdaptation;
      openNeuroCodeAdaptation(adaptation.code, adaptation.title, adaptation.desc, document.activeElement);
    }

    function openActivePassAdaptation() {
      if (!activeCrisisPass) return;
      var pass = activeCrisisPass;
      closeCrisisHud();
      var triggers = [
        document.getElementById('desktop-space-pass-btn'),
        document.querySelector('.mobile-space-pass-item button'),
        document.querySelector('.audh-hamburger')
      ];
      var returnFocus = triggers.find(function(element) {
        return element && element.getClientRects().length > 0;
      });
      openNeuroCodeAdaptation(pass.code, pass.title, pass.desc, returnFocus);
    }

    window.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var adaptationModal = document.getElementById('site-adaptation-modal');
        if (adaptationModal && !adaptationModal.hidden) {
          closeNeuroCodeAdaptation();
          return;
        }
        closeCrisisHud();
        return;
      }
      var modal = document.getElementById('site-adaptation-modal');
      if (e.key === 'Tab' && modal && !modal.hidden) {
        var focusable = Array.from(modal.querySelectorAll('button, input')).filter(function(element) {
          return !element.disabled;
        });
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });

    var currentNeuropediaMode = 'codes';
    var pinnedNeuroCodes = [];
    var currentNeuroCodeTopic = 'all';

    function switchNeuropediaMode(mode) {
      playTactileClick(330, 0.04);
      currentNeuropediaMode = mode;
      var codesView = document.getElementById('neuropedia-codes-view');
      var codesControls = document.getElementById('neuropedia-codes-controls');
      var condView = document.getElementById('neuropedia-conditions-view');
      var embed41 = document.getElementById('embed41');
      var embed07 = document.getElementById('embed07');
      var btnCodes = document.getElementById('tab-btn-codes');
      var btnCond = document.getElementById('tab-btn-conditions');

      if (mode === 'conditions') {
        codesView.style.display = 'none';
        codesControls.hidden = true;
        condView.style.display = 'block';
        embed41.classList.remove('active-embed');
        embed07.classList.remove('active-embed');
        btnCond.className = 'px-5 py-2.5 rounded-lg font-mono text-xs font-extrabold uppercase tracking-wider bg-[#cbb678] text-[#252923] transition';
        btnCodes.className = 'px-5 py-2.5 rounded-lg font-mono text-xs font-extrabold uppercase tracking-wider text-slate-300 hover:text-white transition';
        renderConditionGuide();
      } else {
        codesView.style.display = 'block';
        codesControls.hidden = false;
        condView.style.display = 'none';
        embed41.classList.add('active-embed');
        embed07.classList.add('active-embed');
        btnCodes.className = 'px-5 py-2.5 rounded-lg font-mono text-xs font-extrabold uppercase tracking-wider bg-[#cbb678] text-[#252923] transition';
        btnCond.className = 'px-5 py-2.5 rounded-lg font-mono text-xs font-extrabold uppercase tracking-wider text-slate-300 hover:text-white transition';
      }
    }

    function flipAllNeuroCodes(flipState) {
      playTactileClick(280, 0.05);
      document.querySelectorAll('.flip-card').forEach(function(card) {
        card.classList.toggle('flipped', flipState);
      });
    }

    function filterNeuroCodes() {
      var searchInput = document.getElementById('nc-search-input');
      var q = (searchInput ? searchInput.value : '').toLowerCase().trim();
      document.querySelectorAll('.flip-card').forEach(function(card) {
        var text = card.textContent.toLowerCase();
        var series = card.closest('.series-block-container');
        var tag = series && series.querySelector('.series-tag');
        var category = tag ? tag.textContent.toLowerCase().trim() : '';
        var categoryMatches = currentNeuroCodeTopic === 'all' ||
          (currentNeuroCodeTopic === 'sensory' && category === 'sensory') ||
          (currentNeuroCodeTopic === 'communication' && category === 'communication') ||
          (currentNeuroCodeTopic === 'social' && category === 'social') ||
          (currentNeuroCodeTopic === 'cognition' && category === 'cognition') ||
          (currentNeuroCodeTopic === 'emergency' && category === 'emergency') ||
          (currentNeuroCodeTopic === 'growth' && (category === 'growth' || category === 'foundation'));
        card.style.display = categoryMatches && (!q || text.includes(q)) ? '' : 'none';
      });
      document.querySelectorAll('.series-block-container').forEach(function(series) {
        var hasVisibleCards = Array.from(series.querySelectorAll('.flip-card')).some(function(card) {
          return card.style.display !== 'none';
        });
        series.style.display = hasVisibleCards ? '' : 'none';
      });
    }

    function filterNeuroCodeTopic(topic) {
      currentNeuroCodeTopic = topic;
      document.querySelectorAll('.code-topic-filter').forEach(function(button) {
        var active = button.getAttribute('data-topic') === topic;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      filterNeuroCodes();
    }

    function togglePinCode(code, title, btnEl) {
      playTactileClick(390, 0.04);
      var idx = pinnedNeuroCodes.findIndex(function(c) { return c.code === code; });
      if (idx > -1) {
        pinnedNeuroCodes.splice(idx, 1);
        if (btnEl) { btnEl.classList.remove('pinned'); btnEl.textContent = 'PIN TO TOP'; }
      } else {
        pinnedNeuroCodes.push({ code: code, title: title });
        if (btnEl) { btnEl.classList.add('pinned'); btnEl.textContent = 'PINNED'; }
      }
      renderPinnedHud();
    }

    function clearPinnedCodes() {
      pinnedNeuroCodes = [];
      document.querySelectorAll('.pin-code-btn').forEach(function(b) {
        b.classList.remove('pinned');
        b.textContent = 'PIN TO TOP';
      });
      renderPinnedHud();
    }

    function renderPinnedHud() {
      var hud = document.getElementById('active-neurocode-hud');
      var list = document.getElementById('pinned-codes-list');
      if (!pinnedNeuroCodes.length) {
        hud.classList.remove('has-pins');
        list.innerHTML = '';
        return;
      }
      hud.classList.add('has-pins');
      list.innerHTML = pinnedNeuroCodes.map(function(item) {
        return '<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#252923] border border-[#cbb678] text-white font-mono text-xs font-bold">' +
          '<strong class="text-[#cbb678]">' + item.code + '</strong> ' + item.title +
          '</span>';
      }).join('');
    }

    /* --------------------------------------------------------------------------
       TOOLKIT LOGIC WIRING (Adjustments Builder, Passport, Battery, and Grants)
       -------------------------------------------------------------------------- */
    const adjustmentData = [
      { id: 'sensory', category: 'Sensory', title: 'Sensory & Acoustic Overload', adjustment: 'Access to a quieter workspace away from high-traffic walkways, permission to wear active noise-cancelling headphones during focus work.' },
      { id: 'written', category: 'Processing', title: 'Reading & Written Processing (Dyslexia)', adjustment: 'Digital documents in accessible fonts with tinted backgrounds, advance copies of meeting agendas, and permission to use text-to-speech tools.' },
      { id: 'motor', category: 'Motor', title: 'Motor Coordination & Ergonomics (Dyspraxia)', adjustment: 'Ergonomic workspace assessment, keyboard/dictation preference over manual handwriting, and clear physical spatial guidance.' },
      { id: 'time', category: 'AuDHD Focus', title: 'Time Blindness & Pacing', adjustment: 'Visual time-timers, flexible arrival/departure windows around core hours, and advance warnings before schedule shifts.' },
      { id: 'numbers', category: 'Processing', title: 'Numerical Working Memory (Dyscalculia)', adjustment: 'Visual colour-coded summary charts instead of raw unformatted spreadsheets, unrestricted calculator access, and zero on-the-spot mental maths pressure.' },
      { id: 'executive', category: 'Executive', title: 'Executive Function & Task Initiation', adjustment: 'Breaking large projects into concrete micro-deadlines with explicit priority rankings rather than competing or ambiguous deadlines.' }
    ];

    function updateAdjustmentLetter() {
      const recipient = document.getElementById('adjRecipient');
      const checks = document.querySelectorAll('#barrierCheckboxes input[type="checkbox"]:checked');
      const output = document.getElementById('adjOutput');
      if (!output) return;

      const recipientText = recipient && recipient.value === 'hr' ? 'Dear HR / Occupational Health Team,' : (recipient && recipient.value === 'uni' ? 'Dear Academic Tutor / Disability Services,' : 'Dear [Line Manager Name],');
      const selectedItems = Array.from(checks).map(cb => {
        const item = adjustmentData.find(i => i.id === cb.value);
        return item ? `• ${item.adjustment}` : '';
      }).filter(Boolean).join('\n\n');

      output.value = `${recipientText}\n\nI am writing to request reasonable adjustments under Section 20 of the Equality Act 2010 to help me perform at my best and sustain my wellbeing in my role.\n\nSpecifically, the following adjustments would make a substantial positive difference:\n\n${selectedItems || '• [Please select at least one barrier]'}\n\nI would welcome a brief conversation next week to discuss putting these in place.\n\nKind regards,\n[Your Name]`;
    }

    function copyAdjustmentEmail() {
      const output = document.getElementById('adjOutput');
      if (!output) return;
      navigator.clipboard.writeText(output.value);
      showToast('Reasonable adjustments email copied to clipboard!');
    }

    const passportTagOptions = [
      'Follow up verbal chats in writing',
      'Direct, literal language without subtext',
      'Noise-cancelling headphones during focus',
      'Break large projects into micro-deadlines',
      'Quiet space during overwhelm'
    ];

    function togglePassportTag(btn) {
      btn.classList.toggle('selected');
      btn.classList.toggle('bg-[#cbb678]');
      btn.classList.toggle('text-[#252923]');
      renderPassport();
    }

    function renderPassport() {
      const nameInput = document.getElementById('passName');
      const neuroInput = document.getElementById('passNeurotype');
      const prevName = document.getElementById('previewName');
      const prevNeuro = document.getElementById('previewNeurotype');
      const listEl = document.getElementById('list-passport-summary');
      if (!listEl) return;

      if (prevName) prevName.textContent = (nameInput ? nameInput.value : 'Alex Taylor') + ' | Neuro-Passport';
      if (prevNeuro) prevNeuro.textContent = (neuroInput ? neuroInput.value : 'AuDHD & Dyspraxia') + ' Profile';

      const activeTags = document.querySelectorAll('#passport-tags-container .QuickTag.selected');
      listEl.innerHTML = Array.from(activeTags).map(t => `<li>${t.textContent}</li>`).join('') || '<li>No preferences selected.</li>';
    }

    function copyPassportText() {
      const name = document.getElementById('previewName').textContent;
      const neuro = document.getElementById('previewNeurotype').textContent;
      const items = Array.from(document.querySelectorAll('#list-passport-summary li')).map(li => `- ${li.textContent}`).join('\n');
      navigator.clipboard.writeText(`NEURO-COMMUNICATION PASSPORT\nName: ${name}\nProfile: ${neuro}\n\nPreferences:\n${items}`);
      showToast('Communication passport copied to clipboard!');
    }

    function updateBattery() {
      const sensory = parseInt(document.getElementById('slideSensory').value, 10);
      const exec = parseInt(document.getElementById('slideExec').value, 10);
      const motor = parseInt(document.getElementById('slideMotor').value, 10);
      const social = parseInt(document.getElementById('slideSocial').value, 10);

      document.getElementById('valSensory').textContent = sensory + '%';
      document.getElementById('valExec').textContent = exec + '%';
      document.getElementById('valMotor').textContent = motor + '%';
      document.getElementById('valSocial').textContent = social + '%';

      const title = document.getElementById('readoutTitle');
      const desc = document.getElementById('readoutDesc');
      if (!title || !desc) return;

      if (sensory >= 75 && exec <= 35) {
        title.textContent = 'AuDHD Paradox State: Sensory Overloaded yet Under-Dopamined';
        desc.textContent = 'Your senses need quiet, while your brain craves safe stimulation. Try brown noise or a low-light cosy activity.';
      } else if (motor <= 30) {
        title.textContent = 'Motor & Reading Fatigue Alert (Dyspraxia / Dyslexia Drain)';
        desc.textContent = 'Your physical or reading stamina is low. Switch to text-to-speech, voice dictation, and comfortable rest.';
      } else if (sensory >= 75) {
        title.textContent = 'Sensory Overload Warning';
        desc.textContent = 'Reduce lighting and auditory input immediately. Take 10 minutes in a quiet space.';
      } else {
        title.textContent = 'Balanced Baseline Capacity';
        desc.textContent = 'Your sensory load and cognitive stamina are in a workable window. Pace yourself with water breaks.';
      }
    }

    /* 24-Profile Compact Condition & Symptom Atlas Data */
    var fullSpectrumConditions = [
      {
        code: 'ND-01',
        name: 'Executive Age (The Fluid Spectrum)',
        shortTag: 'Chronological Age vs. Fluid Executive Battery',
        category: 'Executive',
        summary: 'Why an intellectually sharp adult can design complex systems or run a university-level project, yet find their executive regulation age fluctuating anywhere from 3 years old to past their actual age depending on safety, sensory load, and emotional triggers.',
        symptoms: [
          'Your intellectual capacity matches or exceeds your birth certificate, but your executive regulation age shifts dynamically rather than sitting at a fixed percentage behind.',
          'Experiencing moments of deep, intuitive mastery where your strategic foresight feels decades ahead, crashing instantly into a state of total overwhelm where basic self-care feels impossibly out of reach.',
          'Emotional triggers like Rejection Sensitive Dysphoria (ND-08) or sudden sensory assaults causing your nervous system to executively revert to a young child\'s state (e.g., ages 3–5) seeking safety and co-regulation.'
        ],
        internalReality: 'A dynamic, high-horsepower engine whose operational age shifts wildly based on the weather of your nervous system—not a broken gauge, but a highly sensitive barometer.',
        externalView: 'People look at your achievements or intelligence and say, "How can someone so capable struggle with something this simple?" completely misunderstanding how fast your internal battery drains.',
        maskingTax: 'Exhausting yourself trying to hold an "adult" facade all day, hiding the sudden drops in executive age behind frantic coping mechanisms until you crash.',
        sanctuaryAdjustment: 'Abandoning shame around executive fluctuation. Recognising when you have dropped into a younger, low-demand state (NC-52, NC-53), building in immediate co-regulation or rest, and allowing yourself the grace to operate from whatever age your nervous system actually is in that moment.',
        relatedCodes: ['NC-52', 'NC-53']
      },
      {
        code: 'ND-02',
        name: 'Executive Dysfunction & Paralysis',
        shortTag: 'Why "Just Do It" Fails',
        category: 'Executive',
        summary: 'When knowing what to do and actually starting it are disconnected, sitting frozen for hours screaming at yourself internally to stand up.',
        symptoms: [
          'Task Initiation Block (NC-41): wanting to do the task, knowing how to do it, and still being physically unable to cross the starting line',
          'Decision Paralysis (NC-48): two equal options crashing your brain\'s sorting system completely',
          'Out of Sight, De-Indexed (NC-47): the second an object or bill goes inside a drawer, your brain deletes its existence'
        ],
        internalReality: 'Revving a car engine to the redline while the clutch is snapped, loads of noise and smoke, zero forward motion.',
        externalView: 'Mislabelled as laziness, procrastination, or "not caring enough".',
        maskingTax: 'Pulling frantic 3:00 AM panic-adrenaline marathons to hide how frozen you were all afternoon.',
        sanctuaryAdjustment: 'Shrink the first step until it feels ridiculous ("just touch the laptop"), use a body double (NC-02), or flip a coin to break decision paralysis.',
        relatedCodes: ['NC-02', 'NC-24', 'NC-41', 'NC-47', 'NC-48']
      },
      {
        code: 'ND-03',
        name: 'Waiting Mode & Time Blindness',
        shortTag: '"Now" vs "Not Now" Time',
        category: 'Executive',
        summary: 'Why a 4:00 PM appointment paralyses your entire day from 9:00 AM onwards.',
        symptoms: [
          'Experiencing time in only two buckets: "Right Now" and "Not Now"',
          'Waiting Mode: your brain locks itself into standby all morning because it knows if you start a task, you\'ll hyperfocus and miss the 4:00 PM event',
          'Underestimating travel and prep time consistently'
        ],
        internalReality: 'Clocks don\'t feel real inside your head, you either watch the clock like a hawk all day or fall through a time trapdoor.',
        externalView: 'People ask "Why didn\'t you get your work done this morning?"',
        maskingTax: 'Arriving 45 minutes early terrified of being late, or sprinting in apologising.',
        sanctuaryAdjustment: 'Book appointments first thing in the morning whenever possible, set "leave the house" alarms, and use visual countdown timers.',
        relatedCodes: ['NC-23', 'NC-41', 'NC-42']
      },
      {
        code: 'ND-04',
        name: 'AuDHD (Autism + ADHD Combined)',
        shortTag: 'The Dual-Engine Tug-of-War',
        category: 'Executive',
        summary: 'Living with two opposite roommates in one head: your autistic side craves routine and literal language, while your ADHD side gets bored in 48 hours.',
        symptoms: [
          'Building an elaborate colour-coded planner in hyperfocus, then abandoning it two days later',
          'Simultaneous sensory seeking and sensory overload: needing music or movement, then suddenly hitting a wall',
          'Social contradiction: chatty and high-energy for an hour, then needing three days alone in the dark'
        ],
        internalReality: 'Whatever you do to feed your ADHD side accidentally overwhelms your autistic side.',
        externalView: 'People assume you\'re "fine" because your ADHD masks your autism in public.',
        maskingTax: 'Policing both sensory distress and physical restlessness at the same time.',
        sanctuaryAdjustment: 'Flexible "menu routines" and pairing quiet spaces with tactile stims.',
        relatedCodes: ['NC-10', 'NC-11', 'NC-23', 'NC-30', 'NC-64']
      },
      {
        code: 'ND-05',
        name: 'Autism (Monotropism & Sensory Intake)',
        shortTag: 'Deep Focus & Literal Clarity',
        category: 'Executive',
        summary: 'A bottom-up, deep-channel operating system built on pattern recognition, raw sensory intake, and zero-subtext honesty.',
        symptoms: [
          'Monotropic focus tunnels: pulling 100% of focus into one deep channel, making interruptions jarring',
          'Bottom-up thinking: needing all foundational details and "why" before a rule makes sense',
          'Zero-subtext communication: saying exactly what you mean and getting exhausted by social riddles'
        ],
        internalReality: 'Manually calculating eye contact, facial expressions, and tone while every light and noise in the room comes in unfiltered.',
        externalView: 'Misread as "blunt" or "aloof" when you\'re simply being direct.',
        maskingTax: 'Rehearsing scripts and forcing eye contact (NC-33) until speech goes offline (NC-53).',
        sanctuaryAdjustment: 'Say what you mean directly, give advance notice of changes (NC-45), and respect solitary recharge (NC-34).',
        relatedCodes: ['NC-10', 'NC-22', 'NC-31', 'NC-32', 'NC-33', 'NC-50']
      },
      {
        code: 'ND-06',
        name: 'ADHD (Interest-Based Nervous System)',
        shortTag: 'Novelty, Urgency & Hyperfocus',
        category: 'Executive',
        summary: 'Not a deficit of attention, but a nervous system regulated by interest, novelty, urgency, and challenge.',
        symptoms: [
          'Unable to force focus on boring admin, yet able to hyperfocus for 12 hours straight on a creative build',
          'Working memory drop-outs and internal or physical restlessness',
          'Dopamine crashes when high-stimulation projects finish'
        ],
        internalReality: 'Thirty browser tabs open at once with no mouse cursor until deadline panic or fascination locks the lens.',
        externalView: 'Labelled "inconsistent" because you can solve a crisis effortlessly but forget basic admin.',
        maskingTax: 'Running on pure anxiety and last-minute adrenaline to meet neurotypical deadlines.',
        sanctuaryAdjustment: 'Body-doubling (NC-02), sprint-based work, and visualised boards.',
        relatedCodes: ['NC-02', 'NC-21', 'NC-23', 'NC-40', 'NC-41', 'NC-42']
      },
      {
        code: 'ND-07',
        name: 'PDA (Pervasive Drive for Autonomy)',
        shortTag: 'Autonomic Demand Avoidance',
        category: 'Executive',
        summary: 'When any demand, expectation, or loss of choice triggers an involuntary nervous-system threat response.',
        symptoms: [
          'Being about to do a task, and the second someone tells you to do it, your body locks up',
          'Internal demand avoidance: basic biological needs registering as threatening demands',
          'Needing equal, collaborative communication rather than top-down authority'
        ],
        internalReality: 'Your nervous system mistakes a routine expectation for a physical trap.',
        externalView: 'Mislabelled as "stubborn" or "defiant".',
        maskingTax: 'People-pleasing until you hit total autonomy burnout.',
        sanctuaryAdjustment: 'Low-pressure, declarative phrasing ("Food is there if you fancy it") and real choices (NC-44).',
        relatedCodes: ['NC-41', 'NC-44', 'NC-54', 'NC-56', 'NC-57']
      },
      {
        code: 'ND-08',
        name: 'RSD (Rejection Sensitive Dysphoria)',
        shortTag: 'Acute Rejection / Critique Pain',
        category: 'Sensory',
        summary: 'An intense, physical nervous-system gut-punch triggered by perceived rejection, criticism, or failure.',
        symptoms: [
          'A short text like "K." or "We need to talk" setting off an immediate adrenaline spike and chest pain',
          'Replaying a minor awkward social moment for days',
          'Perfectionism and people-pleasing to avoid critique at all costs'
        ],
        internalReality: 'Small social friction hits your nervous system like a physical burn.',
        externalView: 'Told you\'re "taking things too personally" or "overreacting".',
        maskingTax: 'Hiding physical panic behind a calm face while your heart races.',
        sanctuaryAdjustment: 'Clear tone tags, direct reassurance, and zero vague cliffhanger messages.',
        relatedCodes: ['NC-01', 'NC-56', 'NC-60']
      },
      {
        code: 'ND-09',
        name: 'Autistic & AuDHD Burnout',
        shortTag: 'Skill Regression & System Crash',
        category: 'Sensory',
        summary: 'A full neurological system crash caused by years of over-masking, sensory overload, and pushing past limits.',
        symptoms: [
          'Skill regression: losing access to skills you used to have (cooking, speaking smoothly, managing noise)',
          'Sensory thresholds dropping so every light and sound feels unbearable',
          'Sleep doesn\'t fix it, waking up exhausted'
        ],
        internalReality: 'Your brain has pulled the main circuit breaker to stop you from frying the wiring.',
        externalView: 'Often misdiagnosed as depression, when standard advice to "go socialise" makes burnout worse.',
        maskingTax: 'The ultimate bill for years of paying the Masking Tax.',
        sanctuaryAdjustment: 'Radical demand reduction, dropping the mask completely, and sensory darkness/quiet.',
        relatedCodes: ['NC-30', 'NC-50', 'NC-64']
      },
      {
        code: 'ND-10',
        name: 'Revenge Bedtime Procrastination & DSPS',
        shortTag: 'Circadian Drift & Night Peace',
        category: 'Sensory',
        summary: 'When your brain only finally feels quiet, unmasked, and in control at 1:30 AM.',
        symptoms: [
          'Staying awake late scrolling or doing hobbies because night-time is the only hour with zero demands',
          'Delayed Sleep Phase: feeling exhausted all afternoon, then getting a second wind at 11:00 PM',
          'Racing thoughts at bedtime because your brain finally has silence'
        ],
        internalReality: 'Staying up late feels like reclaiming your own existence from a day full of demands.',
        externalView: 'Told to "just go to bed earlier".',
        maskingTax: 'Running on chronic sleep debt (NC-43) to fit an 8:00 AM world.',
        sanctuaryAdjustment: 'Guilt-free daytime decompression time and bedtime brown noise anchors.',
        relatedCodes: ['NC-34', 'NC-43', 'NC-64']
      },
      {
        code: 'ND-11',
        name: 'OCD (Intrusive Doubt Loops)',
        shortTag: 'Ego-Dystonic Alarms & Rituals',
        category: 'Sensory',
        summary: 'A threat-detection loop that throws unwanted "what if" thoughts at you and demands rituals for certainty.',
        symptoms: [
          'Intrusive thoughts attacking the values you care about most',
          'Checking, counting, or mental reviewing loops',
          '"Just Right" physical symmetry urges'
        ],
        internalReality: 'A faulty fire alarm screaming in your head over a 0.001% possibility.',
        externalView: 'Trivialised as "liking things tidy".',
        maskingTax: 'Performing mental rituals silently while acting normal.',
        sanctuaryAdjustment: 'Neutral external redirection (NC-58) without shame.',
        relatedCodes: ['NC-21', 'NC-48', 'NC-58', 'NC-64']
      },
      {
        code: 'ND-12',
        name: 'Dyslexia (3D Spatial vs 2D Text)',
        shortTag: 'Big-Picture Systems Thinking',
        category: 'Learning',
        summary: 'A 3D, interconnected spatial brain forced to squeeze ideas through flat, 2D lines of phonetic spelling.',
        symptoms: [
          'Visual glare and letter crowding when reading dense paragraphs (NC-14)',
          'Seeing the whole system architecture instantly, but losing stamina when spelling sequentially',
          'Reading slower under timed pressure despite high conceptual intelligence'
        ],
        internalReality: 'Thinking in 3D IMAX cinema, then pushing it through a tiny letterbox one letter at a time.',
        externalView: 'Unfairly judged by spelling speed rather than idea depth.',
        maskingTax: 'Triple-checking messages and swapping big words for smaller ones.',
        sanctuaryAdjustment: 'Atkinson Hyperlegible font, wide spacing, Bionic bold anchors, and matte dark backgrounds.',
        relatedCodes: ['NC-14', 'NC-16', 'NC-20', 'NC-27']
      },
      {
        code: 'ND-13',
        name: 'Dyscalculia (Number & Time Slippage)',
        shortTag: 'Numerical Working Memory',
        category: 'Learning',
        summary: 'When numbers, quantities, and time estimates refuse to hold a solid shape in working memory.',
        symptoms: [
          'Needing to count items one-by-one because quantities don\'t group automatically',
          'Digits flipping or vanishing during mental maths',
          'Struggling to judge distances or how many minutes have passed (NC-42)'
        ],
        internalReality: 'Numbers feel like wet soap, try to hold two together and one slips out.',
        externalView: 'Told you "aren\'t a maths person".',
        maskingTax: 'Panic when put on the spot for figures or prices (NC-57).',
        sanctuaryAdjustment: 'Visual progress bars and zero-shame calculator access.',
        relatedCodes: ['NC-16', 'NC-21', 'NC-42', 'NC-57']
      },
      {
        code: 'ND-14',
        name: 'Dysgraphia (Brain-to-Pen Bottleneck)',
        shortTag: 'Fine-Motor Transcription',
        category: 'Learning',
        summary: 'When thoughts run at 100mph in full sentences, but the physical wire to a pen scrambles and cramps your hand.',
        symptoms: [
          'Physical hand and forearm pain after writing just a few lines',
          'Inconsistent letter sizes because your brain is three sentences ahead of your pen',
          'Fluent expression when typing or speaking'
        ],
        internalReality: 'Your mind is a laser printer, but your hand is stuck buffering.',
        externalView: 'Judged for "messy handwriting".',
        maskingTax: 'Gripping pens until your hand aches to force neatness.',
        sanctuaryAdjustment: 'Digital-first forms, keyboard access, and voice-to-text parity.',
        relatedCodes: ['NC-25', 'NC-46', 'NC-57']
      },
      {
        code: 'ND-15',
        name: 'Dyspraxia / DCD (Motor & Spatial GPS)',
        shortTag: '"Body in Space" Calibration',
        category: 'Motor',
        summary: 'A calibration gap between your brain planning a movement and your body executing it smoothly.',
        symptoms: [
          'Proprioception gaps (NC-46): bumping into doorframes or misjudging grip force',
          'Consciously thinking through physical sequences that others do on autopilot',
          'Postural fatigue from standing still'
        ],
        internalReality: 'Knowing the move you want, but the Wi-Fi signal to your limbs drops packets.',
        externalView: 'Written off as "clumsy".',
        maskingTax: 'Hyper-monitoring every movement in public.',
        sanctuaryAdjustment: 'Uncluttered walkways and supportive seating.',
        relatedCodes: ['NC-24', 'NC-36', 'NC-46', 'NC-57']
      },
      {
        code: 'ND-16',
        name: 'Tourette Syndrome & Tic Disorders',
        shortTag: 'Premonitory Urges & Tics',
        category: 'Motor',
        summary: 'Involuntary motor and vocal tics driven by a mounting physical urge that resets only upon release.',
        symptoms: [
          'Premonitory sensory urge: an internal physical itch or pressure before a tic',
          'Motor and vocal tics spiking under stress, fluorescent lights, or when stared at (NC-57)',
          'Exhaustion after suppressing tics in public'
        ],
        internalReality: 'Holding in a tic takes 90% of your brainpower.',
        externalView: 'Stared at or treated like a voluntary habit.',
        maskingTax: 'Muscle pain and exhaustion from holding tics back.',
        sanctuaryAdjustment: 'Total normalisation of regulatory movement (NC-37), don\'t stare, just carry on.',
        relatedCodes: ['NC-11', 'NC-30', 'NC-37', 'NC-57', 'NC-63']
      },
      {
        code: 'ND-17',
        name: 'Auditory Processing Disorder (APD)',
        shortTag: 'Hearing vs Decoding Speech',
        category: 'Sensory',
        summary: 'Your ears work fine, but your brain\'s sound-mixing desk can\'t isolate a voice from background noise.',
        symptoms: [
          'The "Auditory Wall" (NC-18): background noise merges at the same volume as speech',
          'The 3-Second Lag (NC-20): saying "What?" then answering before they repeat it',
          'Needing subtitles on TV'
        ],
        internalReality: 'Every sound arrives on one flat audio track, speech sounds like garbled Sims language.',
        externalView: 'Accused of "not listening".',
        maskingTax: 'Nodding and guessing from facial expressions.',
        sanctuaryAdjustment: 'Written-over-verbal communication (NC-25) and waiting 5 seconds.',
        relatedCodes: ['NC-12', 'NC-18', 'NC-20', 'NC-25', 'NC-59']
      },
      {
        code: 'ND-18',
        name: 'Misophonia (Sound Panic)',
        shortTag: 'Autonomic Trigger Sounds',
        category: 'Sensory',
        summary: 'When specific repetitive sounds bypass logic and trigger instant fight-or-flight panic.',
        symptoms: [
          'Instant surge of visceral rage or skin-crawling distress at mouth or tapping sounds',
          'Unable to think of anything else while the sound happens',
          'Intense guilt afterwards'
        ],
        internalReality: 'The sound hot-wires straight into your amygdala\'s survival alarm.',
        externalView: 'Told to "just ignore it".',
        maskingTax: 'Digging nails into palms to hide panic.',
        sanctuaryAdjustment: 'Zero-shame headphone/earplug use and background brown noise.',
        relatedCodes: ['NC-10', 'NC-12']
      },
      {
        code: 'ND-19',
        name: 'ARFID & Sensory Safe-Food Profiles',
        shortTag: 'Sensory Food Safety',
        category: 'Sensory',
        summary: 'When unpredictable food textures, smells, or temperatures trigger an involuntary gag or threat reflex.',
        symptoms: [
          'Relying on "samefoods" that taste and feel the exact same every time',
          'One unexpected texture in a meal making it impossible to continue',
          'Preferring starvation over unsafe textures'
        ],
        internalReality: 'Your sensory system flags an unpredictable texture the same way neurotypicals flag eating gravel.',
        externalView: 'Shamed as "fussy".',
        maskingTax: 'Anxiety around social meals and restaurants.',
        sanctuaryAdjustment: 'Never comment on someone\'s plate, provide predictable options.',
        relatedCodes: ['NC-13', 'NC-15', 'NC-40']
      },
      {
        code: 'ND-20',
        name: 'Sensory Processing Disorder (SPD)',
        shortTag: 'Hypersensitive & Sensory Seeking',
        category: 'Sensory',
        summary: 'When your sensory volume knobs are turned up to 11 with no limiter.',
        symptoms: [
          'Tactile pain from clothing tags or seams (NC-13)',
          'Visual & olfactory overload from strip lights (NC-14) or perfumes (NC-15)',
          'Thermal drain (NC-17) wiping out cognitive battery'
        ],
        internalReality: 'Living without sensory calluses in a loud, bright world.',
        externalView: 'Called "dramatic" for needing sunglasses or headphones.',
        maskingTax: 'Enduring physical sensory pain silently.',
        sanctuaryAdjustment: 'Tagless clothing, dimmable warm lights, and fragrance-free zones.',
        relatedCodes: ['NC-10', 'NC-11', 'NC-13', 'NC-14', 'NC-15', 'NC-17']
      },
      {
        code: 'ND-21',
        name: 'Alexithymia & Interoception',
        shortTag: 'Missed Body & Emotion Cues',
        category: 'Sensory',
        summary: 'When internal dashboard gauges for hunger, thirst, temperature, and emotions don\'t ping until 0%.',
        symptoms: [
          'Not noticing hunger or bathroom needs for hours until shakiness hits (NC-40)',
          'Delayed emotional processing (taking days to realise how you felt)',
          'Feeling emotions as physical body sensations'
        ],
        internalReality: 'Your body skips warnings and jumps straight to shutdown.',
        externalView: 'Pressured to "tell me how you feel right now".',
        maskingTax: 'Inventing fake emotional answers.',
        sanctuaryAdjustment: 'Use concrete Neuro-Codes instead of vague questions.',
        relatedCodes: ['NC-17', 'NC-20', 'NC-36', 'NC-40', 'NC-64']
      },
      {
        code: 'ND-22',
        name: 'BFRBs (Skin Picking & Hair Pulling)',
        shortTag: 'Body-Focused Repetitive Stims',
        category: 'Motor',
        summary: 'Automatic, sensory-driven grooming/regulation loops triggered by understimulation or stress.',
        symptoms: [
          'Scanning skin or hair on autopilot while reading or stressed',
          'Seeking tactile feedback to keep your brain anchored',
          'Shame spirals from unhelpful comments'
        ],
        internalReality: 'An unconscious sensory-motor regulation loop keeping your brain anchored.',
        externalView: 'Misunderstood as self-harm.',
        maskingTax: 'Hiding hands and carrying guilt.',
        sanctuaryAdjustment: 'Keep tactile fidgets in every pocket.',
        relatedCodes: ['NC-11', 'NC-13', 'NC-37', 'NC-58']
      },
      {
        code: 'ND-23',
        name: 'Hyperlexia & Aphantasia',
        shortTag: 'Visual & Linguistic Extremes',
        category: 'Learning',
        summary: 'Operating at the extremes of pattern-reading and mental imagery, from precocious decoding to a picture-free mind\'s eye.',
        symptoms: [
          'Hyperlexia: precocious reading and pattern decoding',
          'Aphantasia: having zero visual pictures in your mind\'s eye, thinking purely in abstract concepts and words'
        ],
        internalReality: 'Assuming everyone else\'s head works the same way.',
        externalView: 'Teaching methods assuming universal visualisation.',
        maskingTax: 'Translating internal concepts into linear explanations.',
        sanctuaryAdjustment: 'Multi-modal tools combining text and concrete structures.',
        relatedCodes: ['NC-25', 'NC-27', 'NC-32']
      },
      {
        code: 'ND-24',
        name: 'Synaesthesia & CPTSD Overlap',
        shortTag: 'Cross-Wired Senses & Vigilance',
        category: 'Sensory',
        summary: 'How cross-wired sensory channels and the cumulative trauma of growing up unaccommodated shape the nervous system.',
        symptoms: [
          'Synaesthesia: letters having colours, sounds having shapes',
          'CPTSD & Tone Trigger (NC-56): hyper-vigilance from years of being punished for unchangeable traits'
        ],
        internalReality: 'Your nervous system remembers every time you were penalised for stimming.',
        externalView: 'Wondering why you are guarded around authority.',
        maskingTax: 'Living in chronic fight-or-flight.',
        sanctuaryAdjustment: 'Explicit safety signals (NC-01) and full bodily autonomy.',
        relatedCodes: ['NC-01', 'NC-30', 'NC-54', 'NC-56']
      }
    ];

    var currentCondCategory = 'all';

    function setCondCategory(cat) {
      playTactileClick(300, 0.035);
      currentCondCategory = cat;
      document.querySelectorAll('.cond-pill').forEach(function(btn) {
        if (btn.getAttribute('data-cat') === cat) {
          btn.className = 'cond-pill px-3 py-1.5 rounded-lg font-mono text-xs font-bold bg-[#cbb678] text-[#252923]';
        } else {
          btn.className = 'cond-pill px-3 py-1.5 rounded-lg font-mono text-xs font-bold bg-[#252923] text-slate-300 border border-slate-700';
        }
      });
      renderConditionGuide();
    }

    function renderConditionGuide() {
      var mount = document.getElementById('condition-cards-mount');
      if (!mount) return;
      var q = (document.getElementById('cond-search-input').value || '').toLowerCase().trim();

      var filtered = fullSpectrumConditions.filter(function(c) {
        var matchCat = (currentCondCategory === 'all') || (c.category === currentCondCategory);
        var matchQ = !q ||
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.shortTag.toLowerCase().includes(q) ||
          c.summary.toLowerCase().includes(q) ||
          c.internalReality.toLowerCase().includes(q) ||
          c.maskingTax.toLowerCase().includes(q) ||
          c.sanctuaryAdjustment.toLowerCase().includes(q) ||
          c.symptoms.some(function(s) { return s.toLowerCase().includes(q); });
        return matchCat && matchQ;
      });

      if (!filtered.length) {
        mount.innerHTML = '<div class="col-span-full p-8 text-center bg-[#292c25] border border-slate-800 rounded-xl font-mono text-sm text-slate-400">NO MATCHING PROFILES FOUND · Try clearing your search box.</div>';
        return;
      }

      mount.innerHTML = filtered.map(function(c) {
        return '<div class="cond-compact-card" onclick="openConditionModal(\'' + c.code + '\')">' +
          '<span class="card-code-badge">' + c.code + '</span>' +
          '<span class="card-title">' + c.name + '</span>' +
          '<span class="text-xs text-sky-300 font-medium leading-snug px-1">' + c.shortTag + '</span>' +
          '<span class="tap-hint">TAP TO OPEN FULL PROFILE &rarr;</span>' +
        '</div>';
      }).join('');
      mount.querySelectorAll('.cond-compact-card').forEach(groupCardLabel);
    }

    function openConditionModal(code) {
      var c = fullSpectrumConditions.find(function(item) { return item.code === code; });
      if (!c) return;
      playTactileClick(380, 0.05);

      var symList = c.symptoms.map(function(s) {
        return '<li class="flex items-start gap-2.5 text-sm text-slate-200"><span class="text-[#cbb678] mt-0.5">◆</span><span>' + s + '</span></li>';
      }).join('');

      var codeBadges = c.relatedCodes.map(function(rc) {
        return '<button onclick="closeConditionModal(); switchNeuropediaMode(\'codes\'); document.getElementById(\'nc-search-input\').value=\'' + rc + '\'; filterNeuroCodes();" class="px-3 py-1.5 rounded-lg bg-[#303329] border border-[#cbb678]/50 text-[#cbb678] hover:bg-[#cbb678] hover:text-[#252923] font-mono text-xs font-bold transition">' + rc + ' &rarr;</button>';
      }).join('');

      var content = document.getElementById('condition-modal-content');
      content.dataset.conditionCode = c.code;
      content.innerHTML =
        '<div class="condition-modal-header flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-5">' +
          '<span class="organic-badge">' + c.code + ' · ' + c.category.toUpperCase() + ' PROFILE</span>' +
          '<button type="button" aria-label="Close profile" title="Close profile" onclick="closeConditionModal()" class="w-10 h-10 rounded-lg bg-[#252923] border border-slate-700 text-slate-300 hover:text-white hover:border-[#cbb678] text-lg font-bold transition">' +
            '<span aria-hidden="true">✕</span>' +
          '</button>' +
        '</div>' +
        '<h2 class="text-2xl sm:text-3xl font-black text-white mb-2">' + c.name + '</h2>' +
        '<p class="condition-modal-summary text-sky-300 text-base font-medium leading-relaxed mb-5">' + c.summary + '</p>' +
        '<div class="condition-modal-symptoms mb-5 p-4 rounded-xl bg-[#252923] border border-slate-800">' +
          '<div class="font-mono text-xs font-extrabold text-[#cbb678] uppercase tracking-wider mb-2.5">WHAT IT ACTUALLY LOOKS &amp; FEELS LIKE:</div>' +
          '<ul class="space-y-2.5 m-0 p-0 list-none">' + symList + '</ul>' +
        '</div>' +
        '<div class="condition-modal-details grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">' +
          '<div class="p-4 rounded-xl bg-[#252923] border border-sky-500/30">' +
            '<div class="font-mono text-xs font-extrabold text-sky-400 uppercase mb-1">01 · INSIDE YOUR HEAD</div>' +
            '<p class="text-slate-200 text-xs sm:text-sm leading-relaxed m-0">' + c.internalReality + '</p>' +
          '</div>' +
          '<div class="p-4 rounded-xl bg-[#252923] border border-slate-800">' +
            '<div class="font-mono text-xs font-extrabold text-slate-400 uppercase mb-1">02 · HOW OTHERS MISREAD IT</div>' +
            '<p class="text-slate-300 text-xs sm:text-sm leading-relaxed m-0">' + c.externalView + '</p>' +
          '</div>' +
          '<div class="p-4 rounded-xl bg-[#252923] border border-rose-500/30">' +
            '<div class="font-mono text-xs font-extrabold text-rose-400 uppercase mb-1">03 · THE MASKING TAX</div>' +
            '<p class="text-slate-200 text-xs sm:text-sm leading-relaxed m-0">' + c.maskingTax + '</p>' +
          '</div>' +
          '<div class="p-4 rounded-xl bg-[#252923] border border-emerald-500/30">' +
            '<div class="font-mono text-xs font-extrabold text-emerald-400 uppercase mb-1">04 · WHAT ACTUALLY HELPS (SANCTUARY FIX)</div>' +
            '<p class="text-slate-200 text-xs sm:text-sm leading-relaxed m-0">' + c.sanctuaryAdjustment + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="condition-modal-codes pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">' +
          '<span class="font-mono text-xs text-slate-400">USE THESE NEURO-CODES WHEN THIS HITS:</span>' +
          '<div class="flex flex-wrap gap-1.5">' + codeBadges + '</div>' +
        '</div>';

      document.getElementById('condition-detail-modal').classList.add('modal-open');
    }

    function closeConditionModal() {
      var modal = document.getElementById('condition-detail-modal');
      if (modal && modal.classList.contains('modal-open')) {
        playTactileClick(240, 0.04);
        modal.classList.remove('modal-open');
      }
    }

    window.setSanctuaryAudio = function(mode) {
      try {
        if (sanctuaryNode) {
          try { sanctuaryNode.stop(); } catch(e) {}
          try { sanctuaryNode.disconnect(); } catch(e) {}
          sanctuaryNode = null;
        }
        if (mode === 'off') return;

        var ctx = getAudioContext();
        if (!ctx) return;

        sanctuaryGain = ctx.createGain();
        var volEl = document.getElementById('sanctuary-vol');
        var vol = volEl ? parseFloat(volEl.value) : 0.12;
        sanctuaryGain.gain.setValueAtTime(vol, ctx.currentTime);
        sanctuaryGain.connect(ctx.destination);

        if (mode === 'gamma') {
          var osc1 = ctx.createOscillator();
          var osc2 = ctx.createOscillator();
          var merger = ctx.createGain();
          osc1.type = 'sine';
          osc2.type = 'sine';
          osc1.frequency.setValueAtTime(160, ctx.currentTime);
          osc2.frequency.setValueAtTime(200, ctx.currentTime);
          osc1.connect(merger);
          osc2.connect(merger);
          merger.gain.setValueAtTime(0.4, ctx.currentTime);
          merger.connect(sanctuaryGain);
          osc1.start();
          osc2.start();
          sanctuaryNode = {
            stop: function() { osc1.stop(); osc2.stop(); },
            disconnect: function() { merger.disconnect(); }
          };
        } else {
          var bufferSize = 2 * ctx.sampleRate;
          var noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          var output = noiseBuffer.getChannelData(0);
          var lastOut = 0.0;
          for (var i = 0; i < bufferSize; i++) {
            var white = Math.random() * 2 - 1;
            output[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = output[i];
            output[i] *= (mode === 'brown' ? 3.2 : 1.8);
          }
          var whiteNoise = ctx.createBufferSource();
          whiteNoise.buffer = noiseBuffer;
          whiteNoise.loop = true;

          var filter = ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(mode === 'brown' ? 420 : 950, ctx.currentTime);

          whiteNoise.connect(filter);
          filter.connect(sanctuaryGain);
          whiteNoise.start(0);
          sanctuaryNode = whiteNoise;
        }
      } catch (e) {}
    };

    window.updateSanctuaryVolume = function(val) {
      if (sanctuaryGain && audioCtx) {
        sanctuaryGain.gain.setValueAtTime(parseFloat(val), audioCtx.currentTime);
      }
    };

    window.toggleWidgetPanel = function() {
      playTactileClick(320, 0.04);
      var wrapper = document.getElementById('audhme-widget-wrapper');
      if (wrapper) wrapper.classList.toggle('panel-open');
    };

    var SPOON_STORAGE_KEY = 'audhme_spoon_capacity_v1';
    var spoonSliderConfig = [
      { id: 'spoon-sensory', valueId: 'spoon-sensory-value', name: 'Sensory Load' },
      { id: 'spoon-executive', valueId: 'spoon-executive-value', name: 'Executive Spoons' },
      { id: 'spoon-motor', valueId: 'spoon-motor-value', name: 'Motor & Speech Stamina' },
      { id: 'spoon-social', valueId: 'spoon-social-value', name: 'Social & Unmasking Reserve' }
    ];

    function saveSpoonPreferences() {
      var values = {};
      spoonSliderConfig.forEach(function(config) {
        var slider = document.getElementById(config.id);
        if (slider) values[config.id] = parseInt(slider.value, 10);
      });
      values.lowMode = document.body.getAttribute('data-spoons') === 'low';
      try {
        localStorage.setItem(SPOON_STORAGE_KEY, JSON.stringify(values));
      } catch (error) {}
    }

    function getSpoonTip(values) {
      var lowest = null;
      var lowestName = '';
      var lowestValue = 101;
      spoonSliderConfig.forEach(function(config, index) {
        var value = values[index];
        if (value < lowestValue) {
          lowestValue = value;
          lowestName = config.name;
          lowest = config.id;
        }
      });

      var average = values.reduce(function(total, value) { return total + value; }, 0) / values.length;
      var quick = average >= 75 ? 'Capacity: steadier' : average >= 50 ? 'Capacity: manageable' : average >= 30 ? 'Capacity: low' : 'Capacity: very low';
      document.getElementById('spoon-overall-value').textContent = Math.round(average);
      document.getElementById('spoon-quick-summary').textContent = quick + ' · Lowest: ' + lowestName + ' at ' + lowestValue + '%';

      var regulator = '';
      if (average >= 75) {
        regulator = 'You may have enough capacity for one useful task in the next thirty minutes. Keep breaks in and leave an easy way to stop.';
      } else if (average >= 50) {
        regulator = 'Choose one manageable priority, reduce optional demands, and keep the next thirty minutes deliberately simple.';
      } else if (average >= 30) {
        regulator = 'Your capacity is thin. Cancel or postpone one demand, use familiar comforts, and protect the next thirty minutes for recovery.';
      } else {
        regulator = 'This looks like an emergency low-spoons window. Stop extra demands, use the shortest available support, and rest now if you can.';
      }

      if (lowestValue < 35) {
        if (lowest === 'spoon-sensory') regulator += ' Lower light, sound, and other sensory demands first.';
        if (lowest === 'spoon-executive') regulator += ' Write down one next step and hide the rest.';
        if (lowest === 'spoon-motor') regulator += ' Let movement, speech, and writing be minimal or assisted.';
        if (lowest === 'spoon-social') regulator += ' Use a short boundary or non-speaking alternative instead of masking.';
      }
      return regulator;
    }

    function updateSpoonTracker() {
      var values = [];
      spoonSliderConfig.forEach(function(config) {
        var slider = document.getElementById(config.id);
        var output = document.getElementById(config.valueId);
        if (!slider) return;
        var value = parseInt(slider.value, 10);
        values.push(value);
        if (output) output.textContent = value + '%';
      });
      var tip = document.getElementById('spoon-regulation-tip');
      if (tip && values.length === spoonSliderConfig.length) tip.textContent = getSpoonTip(values);
      saveSpoonPreferences();
    }

    function initSpoonTracker() {
      var saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(SPOON_STORAGE_KEY) || 'null');
      } catch (error) {
        saved = null;
      }

      spoonSliderConfig.forEach(function(config) {
        var slider = document.getElementById(config.id);
        if (!slider) return;
        if (saved && Number.isFinite(saved[config.id])) {
          slider.value = Math.max(0, Math.min(100, saved[config.id]));
        }
        slider.addEventListener('input', updateSpoonTracker);
      });

      var lowMode = !!(saved && saved.lowMode);
      document.body.toggleAttribute('data-spoons', lowMode);
      if (!lowMode) document.body.removeAttribute('data-spoons');
      else document.body.setAttribute('data-spoons', 'low');

      document.querySelectorAll('[data-low-spoons-toggle]').forEach(function(toggle) {
        toggle.setAttribute('aria-pressed', lowMode ? 'true' : 'false');
        toggle.textContent = lowMode ? 'Low-Spoons Mode: On' : 'Low-Spoons Mode';
      });
      updateSpoonTracker();
    }

    window.toggleLowSpoonsMode = function() {
      var enabled = document.body.getAttribute('data-spoons') !== 'low';
      if (enabled) document.body.setAttribute('data-spoons', 'low');
      else document.body.removeAttribute('data-spoons');
      document.querySelectorAll('[data-low-spoons-toggle]').forEach(function(toggle) {
        toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        toggle.textContent = enabled ? 'Low-Spoons Mode: On' : 'Low-Spoons Mode';
      });
      playTactileClick(enabled ? 320 : 280, 0.04);
      saveSpoonPreferences();
    };

    window.toggleLowInputMode = function(enabled) {
      document.body.classList.toggle('low-input-active', enabled);
    };

    window.toggleReadingPreference = function(preference, enabled) {
      var classByPreference = {
        warm: 'theme-warm-slate',
        motion: 'low-input-active',
        calm: 'low-stim-active',
        spacing: 'dyslexia-spacing-active'
      };
      var className = classByPreference[preference];
      if (!className) return;

      var active = typeof enabled === 'boolean'
        ? enabled
        : !document.body.classList.contains(className);
      document.body.classList.toggle(className, active);

      var checkboxIds = {
        warm: 'chk-warm-tone',
        motion: 'chk-low-motion',
        spacing: 'chk-dyslexia-spacing'
      };
      var checkbox = document.getElementById(checkboxIds[preference]);
      if (checkbox) checkbox.checked = active;
      if (typeof initAtmosphereCanvas === 'function') initAtmosphereCanvas();
    };

    function toggleBionicReading(enable) {
      document.querySelectorAll('.bionic-text').forEach(function(el) {
        if (!el.getAttribute('data-orig')) {
          el.setAttribute('data-orig', el.innerHTML);
        }
        if (!enable) {
          el.innerHTML = el.getAttribute('data-orig');
        } else {
          var raw = el.getAttribute('data-orig');
          el.innerHTML = raw.replace(/(^|>)\s*([^<]+)/g, function(m, pfx, txt) {
            var words = txt.split(' ').map(function(w) {
              if (w.length <= 2) return '<b>' + w + '</b>';
              var cut = Math.ceil(w.length * 0.45);
              return '<b class="text-white font-extrabold">' + w.slice(0, cut) + '</b>' + w.slice(cut);
            }).join(' ');
            return pfx + words;
          });
        }
      });
    }

    /* ==========================================================================
       LIVING SANCTUARY ATMOSPHERE & HOLIDAY ENGINE (LIVE WEATHER & TOGGLES)
       ========================================================================== */
    var ATMO_STORAGE_KEY = 'audhme_atmosphere_prefs_v3';
    var atmoState = {
      time: 'auto',
      season: 'auto',
      weather: 'live',
      holiday: 'auto',
      animationsEnabled: true,
      liveWeatherCondition: '',
      liveWeatherIsStorm: false
    };
    var siteAtmoPolicy = { localTime: true, calendarSeason: true, calendarHoliday: true, liveWeather: true };
    var siteAtmoPolicyStatus = 'Shared atmosphere policy is using the default settings.';
    var siteAtmoPolicyLoaded = false;
    var founderAtmoPreview = { time: 'auto', season: 'auto', holiday: 'auto', weather: 'auto' };
    var atmoParticles = [];
    var atmoSpawnQueue = 0;
    var atmoAnimFrame = null;
    var atmoResizeTimer = null;
    var atmoViewportWidth = window.innerWidth;
    var atmoResolved = { time: 'night', season: 'autumn', weather: 'clear', holiday: 'none' };
    var liveWeatherPending = false;
    var liveWeatherRequest = 0;
    var liveWeatherTimer = null;
    var liveWeatherController = null;
    var liveWeatherStatus = '';
    var liveWeatherDiagnostic = '';

    function loadAtmoPrefs() {
      try {
        var raw = localStorage.getItem(ATMO_STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            atmoState.time = parsed.time || 'auto';
            atmoState.season = parsed.calendarControls === true && parsed.season === 'none' ? 'none' : 'auto';
            atmoState.weather = parsed.weather !== undefined ? parsed.weather : 'live';
            atmoState.holiday = parsed.holiday === 'none' ? 'none' : 'auto';
            atmoState.animationsEnabled = parsed.animationsEnabled !== false;
          }
        }
      } catch (e) {}
    }

    function saveAtmoPrefs() {
      try {
        localStorage.setItem(ATMO_STORAGE_KEY, JSON.stringify({
          time: atmoState.time,
          season: atmoState.season,
          weather: atmoState.weather,
          holiday: atmoState.holiday,
          animationsEnabled: atmoState.animationsEnabled,
          calendarControls: true
        }));
      } catch (e) {}
    }

    function listenForSiteAtmospherePolicy() {
      db.collection('siteSettings').doc('atmosphere').onSnapshot(function(snapshot) {
        if (snapshot.exists) {
          var data = snapshot.data();
          siteAtmoPolicy = {
            localTime: data.localTime !== false,
            calendarSeason: data.calendarSeason !== false,
            calendarHoliday: data.calendarHoliday !== false,
            liveWeather: data.liveWeather !== false
          };
          siteAtmoPolicyStatus = 'Shared atmosphere policy loaded.';
        } else {
          siteAtmoPolicy = { localTime: true, calendarSeason: true, calendarHoliday: true, liveWeather: true };
          siteAtmoPolicyStatus = 'Shared atmosphere policy is using the default settings.';
        }
        siteAtmoPolicyLoaded = true;
        updateSiteAtmosphereControls();
        if (!siteAtmoPolicy.liveWeather && atmoState.weather === 'live') {
          cancelLiveWeatherRequest();
          liveWeatherStatus = 'Live weather is disabled by the site administrator; using seasonal atmosphere.';
          liveWeatherDiagnostic = '';
        } else if (siteAtmoPolicy.liveWeather && atmoState.weather === 'live' && !liveWeatherPending && !atmoState.liveWeatherCondition) {
          fetchLiveLocalWeather();
        }
        applySanctuaryAtmosphere(true);
      }, function(error) {
        console.error('Shared atmosphere policy could not be loaded:', error.code || error.message);
        siteAtmoPolicy.liveWeather = false;
        siteAtmoPolicyLoaded = true;
        siteAtmoPolicyStatus = 'Shared atmosphere settings could not be loaded; live weather is paused until settings can be read.';
        updateSiteAtmosphereControls();
        if (atmoState.weather === 'live') {
          cancelLiveWeatherRequest();
          liveWeatherStatus = 'Live weather is paused because the site atmosphere policy is unavailable.';
          applySanctuaryAtmosphere(true);
        }
      });
    }

    function updateSiteAtmosphereControls() {
      var liveOption = document.querySelector('#atmo-weather-select option[value="live"]');
      if (liveOption) liveOption.disabled = !siteAtmoPolicy.liveWeather;
      var seasonToggle = document.getElementById('atmo-season-toggle');
      if (seasonToggle) seasonToggle.disabled = !siteAtmoPolicy.calendarSeason;
      var holidayToggle = document.getElementById('atmo-holiday-toggle');
      if (holidayToggle) holidayToggle.disabled = !siteAtmoPolicy.calendarHoliday;
      var policyStatus = document.getElementById('admin-atmosphere-policy-status');
      if (policyStatus) policyStatus.textContent = siteAtmoPolicyStatus;
      [
        ['admin-policy-local-time', 'localTime'],
        ['admin-policy-calendar-season', 'calendarSeason'],
        ['admin-policy-calendar-holiday', 'calendarHoliday'],
        ['admin-policy-live-weather', 'liveWeather']
      ].forEach(function(entry) {
        var control = document.getElementById(entry[0]);
        if (control) control.checked = siteAtmoPolicy[entry[1]];
      });
    }

    function detectTimeOfDay() {
      var hr = new Date().getHours();
      if (hr >= 6 && hr < 12) return 'morning';
      if (hr >= 12 && hr < 17) return 'afternoon';
      if (hr >= 17 && hr < 21) return 'evening';
      return 'night';
    }

    function detectSeason() {
      var m = new Date().getMonth();
      if (m >= 2 && m <= 4) return 'spring';
      if (m >= 5 && m <= 7) return 'summer';
      if (m >= 8 && m <= 10) return 'autumn';
      return 'winter';
    }

    function detectHoliday() {
      var now = new Date();
      var m = now.getMonth() + 1;
      var d = now.getDate();

      if (m === 2 && d >= 7 && d <= 14) return 'valentines';
      if (m === 4 && d === 6) return 'founders-day';
      var y = now.getFullYear();
      var a = y % 19, b = Math.floor(y / 100), c = y % 100;
      var q = Math.floor(b / 4), ee = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
      var h = (19 * a + b - q - g + 15) % 30, ii = Math.floor(c / 4), k = c % 4;
      var l = (32 + 2 * ee + 2 * ii - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451);
      var easterM = Math.floor((h + l - 7 * mm + 114) / 31), easterD = ((h + l - 7 * mm + 114) % 31) + 1;
      var diffDays = Math.round((new Date(y, m - 1, d) - new Date(y, easterM - 1, easterD)) / 86400000);
      if (diffDays >= -3 && diffDays <= 3) return 'easter';
      if (m === 10 && d >= 25) return 'halloween';
      if (m === 11 && d >= 4 && d <= 6) return 'bonfire';
      if (m === 12 && d >= 1 && d <= 26) return 'christmas';
      if ((m === 12 && d === 31) || (m === 1 && d <= 2)) return 'new-year';

      return 'none';
    }

    function detectDefaultWeather(season, time, holiday) {
      if (holiday === 'bonfire' || holiday === 'halloween') return 'embers';
      if (holiday === 'valentines' || holiday === 'easter') return 'clear';
      if (season === 'winter') return (time === 'night' || time === 'morning') ? 'snow' : 'mist';
      if (season === 'autumn') return 'leaves';
      if (season === 'spring') return 'petals';
      return 'clear';
    }

    function cancelLiveWeatherRequest() {
      liveWeatherRequest++;
      if (liveWeatherTimer) clearTimeout(liveWeatherTimer);
      liveWeatherTimer = null;
      if (liveWeatherController) liveWeatherController.abort();
      liveWeatherController = null;
      liveWeatherPending = false;
    }

    function fetchLiveLocalWeather() {
      cancelLiveWeatherRequest();
      if (!siteAtmoPolicyLoaded) {
        liveWeatherStatus = 'Waiting for the shared atmosphere policy before requesting location.';
        applySanctuaryAtmosphere(true);
        return;
      }
      if (!siteAtmoPolicy.liveWeather) {
        liveWeatherStatus = 'Live weather is disabled by the site administrator; using seasonal atmosphere.';
        liveWeatherDiagnostic = '';
        applySanctuaryAtmosphere(true);
        return;
      }
      var request = liveWeatherRequest;
      liveWeatherPending = true;
      liveWeatherStatus = 'Checking local weather; animations will begin when it is ready.';
      liveWeatherDiagnostic = '';
      atmoState.liveWeatherCondition = '';
      atmoState.liveWeatherIsStorm = false;
      applySanctuaryAtmosphere(true);

      function finish(condition, isStorm, error) {
        if (request !== liveWeatherRequest || atmoState.weather !== 'live') return;
        cancelLiveWeatherRequest();
        atmoState.liveWeatherCondition = condition;
        atmoState.liveWeatherIsStorm = isStorm;
        liveWeatherStatus = error ? 'Live weather unavailable. Showing the seasonal atmosphere instead.' : 'Showing live local weather.';
        liveWeatherDiagnostic = error ? (typeof error === 'string' ? error : error.message || 'Unknown weather error.') : '';
        if (error) console.warn('Live weather unavailable:', error.message || error);
        applySanctuaryAtmosphere(true);
      }

      if (!navigator.geolocation) {
        finish('', false, 'Location is not available in this browser.');
        return;
      }
      liveWeatherTimer = setTimeout(function() {
        finish('', false, 'The location or weather request timed out.');
      }, 12000);
      navigator.geolocation.getCurrentPosition(function(pos) {
        if (request !== liveWeatherRequest || atmoState.weather !== 'live') return;
        var lat = pos.coords.latitude.toFixed(2);
        var lon = pos.coords.longitude.toFixed(2);
        liveWeatherController = new AbortController();
        fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current_weather=true', { signal: liveWeatherController.signal })
          .then(function(r) {
            if (!r.ok) throw new Error('Weather service returned HTTP ' + r.status + '.');
            return r.json();
          })
          .then(function(data) {
            if (!data || !data.current_weather || typeof data.current_weather.weathercode !== 'number') throw new Error('Weather service returned an invalid response.');
            var code = data.current_weather.weathercode;
            var condition = 'clear';
            if (code >= 71 && code <= 77 || code >= 85 && code <= 86) condition = 'snow';
            else if (code >= 51 && code <= 67 || code >= 80 && code <= 82 || code >= 95) condition = 'rain';
            else if (code >= 45 && code <= 48) condition = 'mist';
            finish(condition, code >= 95 && code <= 99);
          })
          .catch(function(error) {
            finish('', false, error);
          });
      }, function(error) {
        finish('', false, error);
      });
    }

    window.updateSanctuaryAtmosphere = function(key, val) {
      playTactileClick(340, 0.045);
      if (key === 'weather' && val === 'live' && !siteAtmoPolicy.liveWeather) {
        liveWeatherStatus = 'Live weather is disabled by the site administrator.';
        updateSiteAtmosphereControls();
        applySanctuaryAtmosphere(true);
        return;
      }
      atmoState[key] = val;
      if (key === 'weather' && val !== 'live') {
        cancelLiveWeatherRequest();
        atmoState.liveWeatherIsStorm = false;
        liveWeatherStatus = '';
        liveWeatherDiagnostic = '';
      }
      saveAtmoPrefs();
      if (key === 'weather' && val === 'live') {
        fetchLiveLocalWeather();
      } else {
        applySanctuaryAtmosphere(true);
      }
    };

    window.toggleAtmoAnimations = function(enabled) {
      playTactileClick(280, 0.04);
      atmoState.animationsEnabled = enabled;
      saveAtmoPrefs();
      var toggleEl = document.getElementById('atmo-anim-toggle');
      if (toggleEl) toggleEl.checked = enabled;
      document.body.classList.toggle('atmo-paused', !enabled);
      initAtmosphereCanvas();
    };

    function applySanctuaryAtmosphere(rebuildParticles) {
      var rTime = founderAtmoPreview.time !== 'auto' ? founderAtmoPreview.time : ((atmoState.time === 'auto') ? (siteAtmoPolicy.localTime ? detectTimeOfDay() : 'afternoon') : atmoState.time);
      var rSeason = founderAtmoPreview.season !== 'auto' ? founderAtmoPreview.season : (atmoState.season === 'auto' && siteAtmoPolicy.calendarSeason ? detectSeason() : 'none');
      var rHoliday = founderAtmoPreview.holiday !== 'auto' ? founderAtmoPreview.holiday : (atmoState.holiday === 'auto' && siteAtmoPolicy.calendarHoliday ? detectHoliday() : 'none');
      var rWeather = founderAtmoPreview.weather === 'auto' ? atmoState.weather : founderAtmoPreview.weather;
      if (rWeather === 'live' && !siteAtmoPolicy.liveWeather) rWeather = 'seasonal';

      if (rWeather === 'live') {
        rWeather = liveWeatherPending ? 'off' : (atmoState.liveWeatherCondition || detectDefaultWeather(rSeason, rTime, rHoliday));
      } else if (rWeather === 'auto' || rWeather === 'seasonal') {
        rWeather = detectDefaultWeather(rSeason, rTime, rHoliday);
      }

      var changed = (
        atmoResolved.time !== rTime ||
        atmoResolved.season !== rSeason ||
        atmoResolved.weather !== rWeather ||
        atmoResolved.holiday !== rHoliday
      );

      atmoResolved = { time: rTime, season: rSeason, weather: rWeather, holiday: rHoliday };

      document.body.setAttribute('data-time-of-day', rTime);
      document.body.setAttribute('data-season', rSeason);
      document.body.setAttribute('data-weather', rWeather);
      document.body.setAttribute('data-holiday', rHoliday);
      document.body.setAttribute('data-storm', founderAtmoPreview.weather === 'auto' && atmoState.weather === 'live' && siteAtmoPolicy.liveWeather && atmoState.liveWeatherIsStorm ? 'true' : 'false');

      var tSel = document.getElementById('atmo-time-select');
      var seasonToggle = document.getElementById('atmo-season-toggle');
      var wSel = document.getElementById('atmo-weather-select');
      var holidayToggle = document.getElementById('atmo-holiday-toggle');
      var toggleEl = document.getElementById('atmo-anim-toggle');
      var weatherStatus = document.getElementById('atmo-weather-status');

      if (tSel) tSel.value = atmoState.time;
      if (seasonToggle) seasonToggle.checked = atmoState.season === 'auto';
      if (wSel) wSel.value = atmoState.weather;
      if (holidayToggle) holidayToggle.checked = atmoState.holiday === 'auto';
      if (toggleEl) toggleEl.checked = atmoState.animationsEnabled;
      if (weatherStatus) weatherStatus.textContent = (liveWeatherStatus ? liveWeatherStatus + ' ' : '') +
        (siteAtmoPolicy.liveWeather
          ? 'Live weather is optional. If selected, your browser asks for location permission and rounded coordinates are sent to Open-Meteo for current conditions.'
          : 'Live weather is disabled site-wide. Your location is not requested; seasonal atmosphere is used instead.');
      document.body.classList.toggle('atmo-paused', !atmoState.animationsEnabled);
      var summaryEl = document.getElementById('atmo-active-summary');
      var previewActive = Object.values(founderAtmoPreview).some(function(value) { return value !== 'auto'; });
      if (summaryEl) {
        var hTag = rHoliday !== 'none' ? ' · ' + rHoliday.toUpperCase() : '';
        summaryEl.textContent = (previewActive ? 'PREVIEW · ' : '') + rTime.toUpperCase() + (rSeason !== 'none' ? ' · ' + rSeason.toUpperCase() : '') + hTag;
      }
      var previewStatus = document.getElementById('founder-preview-status');
      if (previewStatus) previewStatus.textContent = previewActive ? 'Preview active in this browser.' : 'No preview active.';
      var adminWeatherStatus = document.getElementById('founder-weather-status');
      if (adminWeatherStatus) adminWeatherStatus.textContent = 'Local weather: ' + (atmoState.weather === 'live' ? (liveWeatherStatus || 'Not checked yet.') : 'Live weather is not selected.') + (liveWeatherDiagnostic ? ' Details: ' + liveWeatherDiagnostic : '');

      if (rebuildParticles || changed) {
        initAtmosphereCanvas();
      }
    }

    function isMotionPaused() {
      return (
        !atmoState.animationsEnabled ||
        document.body.classList.contains('low-input-active') ||
        document.body.classList.contains('low-stim-active') ||
        document.body.classList.contains('site-adapt-calm') ||
        document.body.classList.contains('site-adapt-motion') ||
        atmoResolved.weather === 'off' ||
        (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      );
    }

    function getAtmoViewportSize() {
      return {
        width: window.innerWidth,
        height: window.innerHeight
      };
    }

    function initAtmosphereCanvas() {
      var canvas = document.getElementById('sanctuary-atmosphere-canvas');
      if (!canvas) return;
      if (atmoAnimFrame) cancelAnimationFrame(atmoAnimFrame);
      atmoAnimFrame = null;
      var viewportSize = getAtmoViewportSize();
      var width = canvas.width = viewportSize.width;
      var height = canvas.height = viewportSize.height;
      var mode = atmoResolved.weather;

      var countMap = { rain: 72, snow: 60, leaves: 36, petals: 34, embers: 44, mist: 18, clear: 40 };
      if (atmoResolved.holiday === 'bonfire') countMap.embers = 12;
      var count = countMap[mode] || 24;
      if (width < 640) count = Math.floor(count * 0.6);

      atmoParticles.length = 0;
      atmoSpawnQueue = 0;
      for (var seedIndex = 0; seedIndex < count; seedIndex++) {
        atmoParticles.push(createAtmoParticle(mode, width, height, true));
      }

      var stormFlashAlpha = 0;
      var bursts = [], rockets = [], sparklers = [], flashes = [];

      function renderFrame() {
        if (isMotionPaused()) {
          var c = canvas.getContext('2d');
          if (c) c.clearRect(0, 0, canvas.width, canvas.height);
          return;
        }
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);

        if (document.body.getAttribute('data-storm') === 'true' && mode === 'rain') {
          if (stormFlashAlpha > 0.005) {
            ctx.fillStyle = 'rgba(226, 232, 240, ' + stormFlashAlpha + ')';
            ctx.fillRect(0, 0, width, height);
            stormFlashAlpha *= 0.82;
          } else if (Math.random() < 0.006) {
            stormFlashAlpha = 0.10 + Math.random() * 0.12;
          }
        }

        for (var j = atmoParticles.length - 1; j >= 0; j--) {
          var p = atmoParticles[j];
          if (p.dying) {
            p.alpha = (p.alpha || 0.5) * 0.94;
            if (p.alpha < 0.02) { atmoParticles.splice(j, 1); continue; }
          }
          p.x += p.vx;
          p.y += p.vy;
          p.phase += p.phaseSpeed;
          if (mode !== 'rain') p.x += Math.sin(p.phase) * p.sway;
          if (!p.dying) {
            if (mode === 'embers') { if (p.y < -20) { p.y = height + 10; p.x = Math.random() * width; } }
            else {
              if (p.y > height + 30) { p.y = -20; p.x = Math.random() * width; }
              else if (p.y < -30) { p.y = height + 20; p.x = Math.random() * width; }
            }
            if (p.x > width + 30) p.x = -20;
            if (p.x < -30) p.x = width + 20;
          }
          drawAtmoParticle(ctx, p, mode);
        }
        var ch = atmoResolved.holiday;
        if (ch === 'new-year' || ch === 'founders-day' || ch === 'bonfire') {
          if (ch === 'bonfire') {
            var fireTime = performance.now() * 0.001;
            var fireBaseY = height + 14;
            var fireCenterX = width * 0.5;
            var fireScale = Math.max(0.72, Math.min(1, width / 900));
            var fireColors = ['#b93b12', '#ea580c', '#f97316', '#fb923c', '#fbbf24'];

            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.translate(fireCenterX, fireBaseY - 78 * fireScale);
            ctx.scale(1, 0.64);
            var fireGlow = ctx.createRadialGradient(0, 0, 18 * fireScale, 0, 0, 155 * fireScale);
            fireGlow.addColorStop(0, 'rgba(254, 240, 138, 0.42)');
            fireGlow.addColorStop(0.28, 'rgba(251, 146, 60, 0.30)');
            fireGlow.addColorStop(0.66, 'rgba(234, 88, 12, 0.13)');
            fireGlow.addColorStop(1, 'rgba(234, 88, 12, 0)');
            ctx.fillStyle = fireGlow;
            ctx.beginPath();
            ctx.arc(0, 0, 155 * fireScale, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            var tongues = [
              { x: -82, h: 118, w: 45, phase: 0.2, color: 0 },
              { x: -48, h: 155, w: 52, phase: 1.1, color: 1 },
              { x: -18, h: 132, w: 58, phase: 2.4, color: 2 },
              { x: 18, h: 168, w: 60, phase: 0.8, color: 1 },
              { x: 52, h: 142, w: 54, phase: 1.9, color: 2 },
              { x: 86, h: 108, w: 43, phase: 3.0, color: 0 }
            ];

            for (var ti = 0; ti < tongues.length; ti++) {
              var tongue = tongues[ti];
              var wave = Math.sin(fireTime * 2.0 + tongue.phase) * 10 * fireScale;
              var tx = fireCenterX + (tongue.x * fireScale) + wave;
              var th = tongue.h * fireScale;
              var tw = tongue.w * fireScale;
              var lean = Math.sin(fireTime * 1.35 + tongue.phase * 1.7) * 8 * fireScale;

              ctx.fillStyle = fireColors[tongue.color];
              ctx.globalAlpha = 0.78;
              ctx.beginPath();
              ctx.moveTo(tx - tw * 0.82, fireBaseY);
              ctx.bezierCurveTo(tx - tw, fireBaseY - th * 0.36, tx - tw * 0.72 + lean, fireBaseY - th * 0.74, tx + lean, fireBaseY - th);
              ctx.bezierCurveTo(tx + tw * 0.2 + lean, fireBaseY - th * 0.62, tx + tw * 0.72, fireBaseY - th * 0.26, tx + tw * 0.82, fireBaseY);
              ctx.quadraticCurveTo(tx, fireBaseY + 5 * fireScale, tx - tw * 0.82, fireBaseY);
              ctx.fill();
            }

            var coreTongues = [
              { x: -42, h: 92, phase: 0.3 },
              { x: 0, h: 116, phase: 2.1 },
              { x: 44, h: 96, phase: 1.2 }
            ];
            for (var ci = 0; ci < coreTongues.length; ci++) {
              var core = coreTongues[ci];
              var cx = fireCenterX + core.x * fireScale + Math.sin(fireTime * 2.4 + core.phase) * 6 * fireScale;
              var chh = core.h * fireScale;
              var cw = 28 * fireScale;
              ctx.fillStyle = '#fef08a';
              ctx.globalAlpha = 0.84;
              ctx.beginPath();
              ctx.moveTo(cx - cw, fireBaseY);
              ctx.bezierCurveTo(cx - cw * 0.8, fireBaseY - chh * 0.42, cx - cw * 0.3, fireBaseY - chh * 0.72, cx + Math.sin(fireTime * 1.7 + core.phase) * 5 * fireScale, fireBaseY - chh);
              ctx.bezierCurveTo(cx + cw * 0.4, fireBaseY - chh * 0.58, cx + cw * 0.8, fireBaseY - chh * 0.22, cx + cw, fireBaseY);
              ctx.quadraticCurveTo(cx, fireBaseY + 4 * fireScale, cx - cw, fireBaseY);
              ctx.fill();
            }
            ctx.restore();
          }
          var goldOnly = ch === 'founders-day';
          var burstPal = goldOnly ? ['#fde68a', '#fcd34d', '#fbbf24', '#fff7cc', '#f59e0b'] : ['#f87171', '#34d399', '#60a5fa', '#fbbf24', '#f472b6', '#f8fafc', '#a78bfa'];
          var sparkPal = ['#fde68a', '#fbbf24', '#fff7cc', '#fb923c', '#fcd34d'];
          if (ch !== 'bonfire') {
            var chance = goldOnly ? 0.008 : 0.02;
            var maxRockets = goldOnly ? 2 : 5;
            if (Math.random() < chance && rockets.length < maxRockets && bursts.length < 800) {
              rockets.push({ x: width * (0.12 + Math.random() * 0.76), y: height + 10, px: width * 0.5, py: height, vy: -(7 + Math.random() * 3.5), targetY: height * (0.15 + Math.random() * 0.32), color: burstPal[Math.floor(Math.random() * burstPal.length)] });
            }
            for (var ri = rockets.length - 1; ri >= 0; ri--) {
              var rk = rockets[ri];
              rk.px = rk.x; rk.py = rk.y;
              rk.y += rk.vy; rk.vy += 0.05;
              ctx.save();
              ctx.globalAlpha = 0.95; ctx.shadowBlur = 10; ctx.shadowColor = rk.color; ctx.fillStyle = rk.color;
              ctx.beginPath(); ctx.arc(rk.x, rk.y, 2.4, 0, 6.283); ctx.fill();
              ctx.strokeStyle = rk.color; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
              ctx.beginPath(); ctx.moveTo(rk.px, rk.py); ctx.lineTo(rk.x, rk.y); ctx.stroke();
              ctx.restore();
              if (rk.y <= rk.targetY || rk.vy >= 0) {
                flashes.push({ x: rk.x, y: rk.y, r: 4, maxR: goldOnly ? 70 : 110, life: 12, color: goldOnly ? '#fcd34d' : '#ffffff' });
                var nb = goldOnly ? 60 : 90;
                for (var si = 0; si < nb; si++) {
                  var ang = Math.random() * 6.283, sp = 1.5 + Math.random() * 4.5;
                  bursts.push({ x: rk.x, y: rk.y, px: rk.x, py: rk.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 55 + Math.random() * 35, maxLife: 90, color: burstPal[Math.floor(Math.random() * burstPal.length)], size: 1.4 + Math.random() * 2 });
                }
                rockets.splice(ri, 1);
              }
            }
          }
          if (ch === 'bonfire') {
            if (bursts.length < 28 && Math.random() < 0.032) {
              var emberX = width * (0.38 + Math.random() * 0.24);
              var emberY = height * (0.88 + Math.random() * 0.08);
              for (var k = 0; k < 6; k++) {
                var a2 = -1.6 + (Math.random() - 0.5) * 0.9;
                var s2 = 0.35 + Math.random() * 0.6;
                bursts.push({
                  x: emberX, y: emberY, px: emberX, py: emberY,
                  vx: Math.cos(a2) * s2, vy: Math.sin(a2) * s2,
                  life: 28 + Math.random() * 16, maxLife: 44,
                  color: sparkPal[Math.floor(Math.random() * sparkPal.length)],
                  size: 1 + Math.random(),
                  sparkler: true
                });
              }
            }
          }
          for (var fi = flashes.length - 1; fi >= 0; fi--) {
            var fl = flashes[fi];
            fl.r += (fl.maxR - fl.r) * 0.2; fl.life--;
            if (fl.life <= 0) { flashes.splice(fi, 1); continue; }
            ctx.save(); ctx.globalAlpha = (fl.life / 12) * 0.35; ctx.strokeStyle = fl.color; ctx.lineWidth = 2; ctx.shadowBlur = 20; ctx.shadowColor = fl.color;
            ctx.beginPath(); ctx.arc(fl.x, fl.y, fl.r, 0, 6.283); ctx.stroke(); ctx.restore();
          }
          for (var bi2 = bursts.length - 1; bi2 >= 0; bi2--) {
            var bb = bursts[bi2];
            bb.px = bb.x; bb.py = bb.y;
            bb.x += bb.vx; bb.y += bb.vy; bb.vy += bb.sparkler ? 0.03 : 0.05; bb.life--;
            if (bb.life <= 0) { bursts.splice(bi2, 1); continue; }
            var aa = Math.max(0, bb.life / bb.maxLife);
            ctx.save();
            ctx.strokeStyle = bb.color; ctx.lineWidth = bb.size * 0.8; ctx.globalAlpha = aa * 0.6;
            ctx.beginPath(); ctx.moveTo(bb.px, bb.py); ctx.lineTo(bb.x, bb.y); ctx.stroke();
            ctx.globalAlpha = aa;
            ctx.shadowBlur = bb.sparkler ? 10 : 14;
            ctx.shadowColor = bb.color;
            ctx.fillStyle = bb.color;
            ctx.beginPath(); ctx.arc(bb.x, bb.y, bb.size, 0, 6.283); ctx.fill();
            ctx.restore();
          }
        } else {
          bursts = []; rockets = []; sparklers = []; flashes = [];
        }

        atmoAnimFrame = requestAnimationFrame(renderFrame);
      }
      atmoAnimFrame = requestAnimationFrame(renderFrame);
    }

    function createAtmoParticle(mode, w, h, randomY) {
      var isNight = atmoResolved.time === 'night';
      var holiday = atmoResolved.holiday;
      var season = atmoResolved.season;
      var rnd = Math.random;
      var TAU = Math.PI * 2;

      if (holiday === 'valentines' && rnd() < 0.6) {
        var hc = ['#f87171', '#f472b6', '#fb7185', '#fda4af'];
        return { kind: 'heart', x: rnd() * w, y: randomY ? rnd() * h : h + 10, vx: (rnd() - 0.5) * 0.3, vy: -(0.3 + rnd() * 0.5), r: 3 + rnd() * 4, color: hc[Math.floor(rnd() * hc.length)], alpha: 0.5 + rnd() * 0.35, phase: rnd() * TAU, phaseSpeed: 0.02 + rnd() * 0.03, sway: 0.5 };
      }
      if (holiday === 'easter' && rnd() < 0.55) {
        var ec = ['#f9a8d4', '#fde68a', '#c4b5fd', '#86efac', '#fda4af'];
        return { kind: 'petal', x: rnd() * w, y: randomY ? rnd() * h : -15, vx: 0.2 + rnd() * 0.4, vy: 0.4 + rnd() * 0.6, r: 3 + rnd() * 4, color: ec[Math.floor(rnd() * ec.length)], alpha: 0.5 + rnd() * 0.3, phase: rnd() * TAU, phaseSpeed: 0.025 + rnd() * 0.03, sway: 1.1 };
      }
      if (holiday === 'halloween' && rnd() < 0.3) {
        return { kind: 'pumpkinGlow', x: rnd() * w, y: randomY ? rnd() * h : h * 0.3 + rnd() * h * 0.6, vx: (rnd() - 0.5) * 0.15, vy: -(0.1 + rnd() * 0.25), r: 6 + rnd() * 10, color: rnd() < 0.5 ? '#fb923c' : '#f97316', alpha: 0.18 + rnd() * 0.2, phase: rnd() * TAU, phaseSpeed: 0.02 + rnd() * 0.03, sway: 0.3 };
      }
      if (holiday === 'new-year' && mode === 'clear' && rnd() < 0.5) {
        var nyColors = ['#fde68a', '#f8fafc', '#fcd34d', '#e2e8f0'];
        return { kind: 'spark', x: rnd() * w, y: randomY ? rnd() * h : h + 10, vx: (rnd() - 0.5) * 0.3, vy: -(0.4 + rnd() * 0.7), r: 1.2 + rnd() * 1.8, color: nyColors[Math.floor(rnd() * nyColors.length)], alpha: 0.5 + rnd() * 0.4, phase: rnd() * TAU, phaseSpeed: 0.05 + rnd() * 0.07, sway: 0.3 };
      }
      if (season === 'summer' && isNight && mode === 'clear' && rnd() < 0.45) {
        var flyColors = ['#bef264', '#fde047', '#86efac'];
        return { kind: 'firefly', x: rnd() * w, y: rnd() * h, vx: (rnd() - 0.5) * 0.12, vy: (rnd() - 0.5) * 0.12, r: 1.2 + rnd() * 1.6, color: flyColors[Math.floor(rnd() * flyColors.length)], alpha: 0.35 + rnd() * 0.4, phase: rnd() * TAU, phaseSpeed: 0.03 + rnd() * 0.05, sway: 0.2 };
      }

      if (mode === 'rain') {
        return { kind: 'drop', x: rnd() * w, y: randomY ? rnd() * h : -20, vx: -0.7, vy: 7 + rnd() * 4, len: 16 + rnd() * 14, alpha: 0.28 + rnd() * 0.3, phase: 0, phaseSpeed: 0, sway: 0 };
      }
      if (mode === 'snow') {
        var big = rnd() < 0.25;
        return { kind: 'flake', x: rnd() * w, y: randomY ? rnd() * h : -10, vx: (rnd() - 0.5) * 0.5, vy: 0.5 + rnd() * 1.0, r: big ? 3.5 + rnd() * 3 : 1.2 + rnd() * 2.2, alpha: big ? 0.35 + rnd() * 0.25 : 0.5 + rnd() * 0.35, phase: rnd() * TAU, phaseSpeed: 0.01 + rnd() * 0.02, sway: 0.7, fluffy: big };
      }
      if (mode === 'leaves') {
        var autumnColors = ['#cbb678', '#c87d55', '#b85d43', '#a38b5d', '#e08e45'];
        return { kind: 'leaf', x: rnd() * w, y: randomY ? rnd() * h : -15, vx: 0.3 + rnd() * 0.5, vy: 0.5 + rnd() * 0.8, r: 4 + rnd() * 5, color: autumnColors[Math.floor(rnd() * autumnColors.length)], alpha: 0.55 + rnd() * 0.35, phase: rnd() * TAU, phaseSpeed: 0.02 + rnd() * 0.03, sway: 0.9 };
      }
      if (mode === 'petals') {
        var springColors = ['#f4c2c9', '#e8b4bc', '#d4c5e2', '#f7d9e0', '#f2d0a9'];
        return { kind: 'petal', x: rnd() * w, y: randomY ? rnd() * h : -15, vx: 0.2 + rnd() * 0.4, vy: 0.4 + rnd() * 0.6, r: 3 + rnd() * 4, color: springColors[Math.floor(rnd() * springColors.length)], alpha: 0.45 + rnd() * 0.3, phase: rnd() * TAU, phaseSpeed: 0.025 + rnd() * 0.03, sway: 1.1 };
      }
      if (mode === 'embers') {
        var emberColors = ['#f0b254', '#e67e22', '#d35400', '#cbb678', '#ff8c42'];
        return { kind: 'ember', x: rnd() * w, y: randomY ? rnd() * h : h + 10, vx: (rnd() - 0.5) * 0.3, vy: -(0.4 + rnd() * 0.8), r: 1.5 + rnd() * 2.5, color: emberColors[Math.floor(rnd() * emberColors.length)], alpha: 0.4 + rnd() * 0.4, phase: rnd() * TAU, phaseSpeed: 0.05 + rnd() * 0.06, sway: 0.4 };
      }
      if (mode === 'mist') {
        return { kind: 'mist', x: rnd() * w, y: rnd() * h, vx: 0.2 + rnd() * 0.3, vy: (rnd() - 0.5) * 0.05, r: 90 + rnd() * 120, alpha: 0.04 + rnd() * 0.05, phase: rnd() * TAU, phaseSpeed: 0.004, sway: 0.1 };
      }
      if (isNight) {
        var starColors = ['#f8fafc', '#dbeafe', '#e0f2fe', '#fef3c7'];
        return { kind: 'star', x: rnd() * w, y: rnd() * h, vx: (rnd() - 0.5) * 0.05, vy: (rnd() - 0.5) * 0.05, r: 0.6 + rnd() * 1.4, color: starColors[Math.floor(rnd() * starColors.length)], alpha: 0.35 + rnd() * 0.5, phase: rnd() * TAU, phaseSpeed: 0.02 + rnd() * 0.05, sway: 0.05 };
      }
      var moteColors = ['#cbb678', '#e8d5a0', '#f2f2e9', '#c9d6c5'];
      return { kind: 'mote', x: rnd() * w, y: rnd() * h, vx: (rnd() - 0.5) * 0.15, vy: (rnd() - 0.5) * 0.1, r: 1 + rnd() * 2, color: moteColors[Math.floor(rnd() * moteColors.length)], alpha: 0.2 + rnd() * 0.3, phase: rnd() * TAU, phaseSpeed: 0.01 + rnd() * 0.02, sway: 0.15 };
    }

    function drawAtmoParticle(ctx, p, mode) {
      var pulse = 0.5 + 0.5 * Math.sin(p.phase);
      var TAU = Math.PI * 2;
      ctx.save();
      switch (p.kind) {
        case 'drop':
          ctx.strokeStyle = 'rgba(190, 215, 210, ' + p.alpha + ')';
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.vx * 1.2, p.y + p.len);
          ctx.stroke();
          break;
        case 'flake':
          ctx.globalAlpha = p.alpha;
          ctx.shadowBlur = p.fluffy ? 6 : 3;
          ctx.shadowColor = 'rgba(240, 248, 246, 0.8)';
          ctx.fillStyle = '#f0f6f4';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, TAU);
          ctx.fill();
          break;
        case 'leaf':
          ctx.translate(p.x, p.y);
          ctx.rotate(p.phase);
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, -p.r);
          ctx.quadraticCurveTo(p.r * 0.7, -p.r * 0.3, p.r * 0.5, p.r * 0.6);
          ctx.quadraticCurveTo(0, p.r, -p.r * 0.5, p.r * 0.6);
          ctx.quadraticCurveTo(-p.r * 0.7, -p.r * 0.3, 0, -p.r);
          ctx.fill();
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(0, -p.r * 0.8);
          ctx.lineTo(0, p.r * 0.7);
          ctx.stroke();
          break;
        case 'petal':
          ctx.translate(p.x, p.y);
          ctx.rotate(p.phase * 0.5);
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.ellipse(0, 0, p.r, p.r * 0.5, 0, 0, TAU);
          ctx.fill();
          break;
        case 'mist':
          var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          g.addColorStop(0, 'rgba(200, 218, 210, ' + p.alpha + ')');
          g.addColorStop(1, 'rgba(200, 218, 210, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, TAU);
          ctx.fill();
          break;
        case 'ember':
          ctx.globalAlpha = Math.max(0.08, p.alpha * (0.45 + 0.55 * pulse));
          ctx.shadowBlur = 10;
          ctx.shadowColor = p.color;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, TAU);
          ctx.fill();
          break;
        case 'star':
          ctx.globalAlpha = Math.max(0.05, p.alpha * (0.35 + 0.65 * pulse));
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, TAU);
          ctx.fill();
          if (p.r > 1.5 && pulse > 0.7) {
            ctx.strokeStyle = p.color;
            ctx.globalAlpha = Math.max(0.03, ctx.globalAlpha * 0.6);
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(p.x - p.r * 2.5, p.y);
            ctx.lineTo(p.x + p.r * 2.5, p.y);
            ctx.moveTo(p.x, p.y - p.r * 2.5);
            ctx.lineTo(p.x, p.y + p.r * 2.5);
            ctx.stroke();
          }
          break;
        case 'mote':
          ctx.globalAlpha = Math.max(0.05, p.alpha * (0.7 + 0.3 * pulse));
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, TAU);
          ctx.fill();
          break;
        case 'spark':
        case 'firefly':
          ctx.globalAlpha = Math.max(0.06, p.alpha * (0.25 + 0.75 * pulse));
          ctx.shadowBlur = p.kind === 'spark' ? 12 : 10;
          ctx.shadowColor = p.color;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, TAU);
          ctx.fill();
          break;
        case 'pumpkinGlow':
          ctx.globalAlpha = Math.max(0.05, p.alpha * (0.6 + 0.4 * pulse));
          ctx.shadowBlur = 24;
          ctx.shadowColor = p.color;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, TAU);
          ctx.fill();
          break;
        case 'heart':
          ctx.translate(p.x, p.y); ctx.globalAlpha = p.alpha; ctx.fillStyle = p.color; ctx.shadowBlur = 8; ctx.shadowColor = p.color;
          ctx.beginPath(); ctx.moveTo(0, p.r * 0.3);
          ctx.bezierCurveTo(-p.r, -p.r * 0.5, -p.r * 0.5, -p.r * 1.2, 0, -p.r * 0.4);
          ctx.bezierCurveTo(p.r * 0.5, -p.r * 1.2, p.r, -p.r * 0.5, 0, p.r * 0.3);
          ctx.fill(); break;
        default:
          ctx.fillStyle = p.color || '#cbb678';
          ctx.globalAlpha = p.alpha;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r || 2, 0, TAU);
          ctx.fill();
      }
      ctx.restore();
    }

    function scheduleAtmoResize() {
      if (atmoResizeTimer) window.clearTimeout(atmoResizeTimer);
      atmoResizeTimer = window.setTimeout(function() {
        var canvas = document.getElementById('sanctuary-atmosphere-canvas');
        var viewportSize = getAtmoViewportSize();
        var widthChanged = canvas && canvas.width !== viewportSize.width;
        var orientationChanged = atmoViewportWidth !== window.innerWidth &&
          Math.abs(atmoViewportWidth - window.innerWidth) >= 80;
        var heightChanged = orientationChanged && canvas &&
          canvas.height !== viewportSize.height;
        if (widthChanged || heightChanged) {
          atmoViewportWidth = window.innerWidth;
          initAtmosphereCanvas();
        }
      }, 180);
    }

    window.addEventListener('resize', scheduleAtmoResize, { passive: true });

    var xmasCountdownInterval = null;
    var xmasLastPhase = null;

    function getChristmasPhase(now) {
      var y = now.getFullYear();
      var start = new Date(y, 11, 1, 0, 0, 0);        // Dec 1, 00:00 local
      var celebrate = new Date(y, 11, 25, 0, 0, 0);  // Dec 25, 00:00 local
      var end = new Date(y, 11, 26, 0, 0, 0);          // Dec 26, 00:00 local
      if (now < start || now >= end) return 'hidden';
      if (now < celebrate) return 'countdown';
      return 'celebration';
    }

    function formatChristmasCountdown(target, now) {
      var diff = Math.max(0, target.getTime() - now.getTime());
      var totalSec = Math.floor(diff / 1000);
      var days = Math.floor(totalSec / 86400);
      var hours = Math.floor((totalSec % 86400) / 3600);
      var mins = Math.floor((totalSec % 3600) / 60);
      var secs = totalSec % 60;
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      return days + 'd ' + pad(hours) + 'h ' + pad(mins) + 'm ' + pad(secs) + 's';
    }

    function updateChristmasCountdown() {
      var banner = document.getElementById('christmas-countdown-banner');
      if (!banner) return;
      var christmasThemeActive = document.body.getAttribute('data-holiday') === 'christmas';
      if (!christmasThemeActive) {
        banner.hidden = true;
        banner.classList.remove('xmas-celebration');
        xmasLastPhase = null;
        return;
      }
      var dismissed = false;
      try { dismissed = sessionStorage.getItem('audhme_xmas_dismissed') === '1'; } catch (e) {}

      var now = new Date();
      var phase = getChristmasPhase(now);
      if (phase === 'hidden' || dismissed) {
        banner.hidden = true;
        banner.classList.remove('xmas-celebration');
        xmasLastPhase = phase;
        return;
      }

      banner.hidden = false;
      var timerEl = document.getElementById('countdown-timer-display');
      var msgEl = document.getElementById('countdown-message');
      var headingEl = banner.querySelector('.holiday-countdown-heading');

      if (phase !== xmasLastPhase) {
        if (phase === 'countdown') {
          banner.classList.remove('xmas-celebration');
          if (timerEl) timerEl.style.display = '';
          if (msgEl) msgEl.textContent = 'The Sanctuary is wrapping itself in light.';
        } else if (phase === 'celebration') {
          banner.classList.add('xmas-celebration');
          if (headingEl) headingEl.textContent = 'Merry Christmas from the AuDHMe Sanctuary';
          if (timerEl) timerEl.style.display = 'none';
          if (msgEl) msgEl.textContent = 'Warmth, rest, and joy to you today - however you celebrate.';
        }
        xmasLastPhase = phase;
      }

      if (phase === 'countdown') {
        var y = now.getFullYear();
        var target = new Date(y, 11, 25, 0, 0, 0);
        if (now.getTime() > target.getTime()) target = new Date(y + 1, 11, 25, 0, 0, 0);
        if (timerEl) timerEl.textContent = formatChristmasCountdown(target, now);
      }
    }

    function dismissChristmasCountdown() {
      try { sessionStorage.setItem('audhme_xmas_dismissed', '1'); } catch (e) {}
      var banner = document.getElementById('christmas-countdown-banner');
      if (banner) banner.hidden = true;
    }
    window.dismissChristmasCountdown = dismissChristmasCountdown;

    function initChristmasCountdown() {
      if (xmasCountdownInterval) clearInterval(xmasCountdownInterval);
      updateChristmasCountdown();
      xmasCountdownInterval = setInterval(updateChristmasCountdown, 1000);
    }

    function initFestiveDecor() {
      var hero = document.querySelector('.orbital-card.core-gateway-node');
      if (hero && !document.getElementById('halloween-pumpkins')) {
        hero.style.position = hero.style.position || 'relative';
        var pump = document.createElement('div');
        pump.id = 'halloween-pumpkins';
        pump.setAttribute('aria-hidden', 'true');
        function pumpkinSvg(fill1, fill2, face) {
          return '<svg class="pumpkin" viewBox="0 0 64 54" aria-hidden="true">' +
            '<rect x="29" y="6" width="6" height="10" rx="2" fill="#2f7d32"/>' +
            '<ellipse cx="32" cy="32" rx="28" ry="19" fill="' + fill1 + '"/>' +
            '<ellipse cx="32" cy="32" rx="20" ry="19" fill="' + fill2 + '" opacity="0.55"/>' +
            '<polygon points="22,28 27,35 17,35" fill="' + face + '"/>' +
            '<polygon points="42,28 47,35 37,35" fill="' + face + '"/>' +
            '<polygon points="32,34 36,41 28,41" fill="' + face + '"/>' +
            '<path d="M20 43 Q32 50 44 43 L41 40 Q32 45 23 40 Z" fill="' + face + '"/>' +
            '</svg>';
        }
        pump.innerHTML =
          '<span class="pk-left">' + pumpkinSvg('#e67e22', '#d35400', '#fde047') + '</span>' +
          '<span class="pk-center">' + pumpkinSvg('#f39c12', '#e67e22', '#fff7cc') + '</span>' +
          '<span class="pk-right">' + pumpkinSvg('#d35400', '#a04000', '#fde047') + '</span>';
        document.body.appendChild(pump);
      }

      if (!document.getElementById('season-decor')) {
        var sd = document.createElement('div');
        sd.id = 'season-decor';
        sd.setAttribute('aria-hidden', 'true');
        document.body.appendChild(sd);
      }
      if (!document.getElementById('origin-rays')) {
        var rays = document.createElement('div');
        rays.id = 'origin-rays';
        rays.setAttribute('aria-hidden', 'true');
        document.body.appendChild(rays);
      }
    }

    document.addEventListener('DOMContentLoaded', function() {
      loadAtmoPrefs();
      listenForSiteAtmospherePolicy();
      if (atmoState.weather === 'live' && siteAtmoPolicyLoaded) {
        fetchLiveLocalWeather();
      } else {
        applySanctuaryAtmosphere(true);
      }
      setInterval(function() { applySanctuaryAtmosphere(false); }, 60000);
      enhanceAllFlipCards();
      handleInitialRoute();
      renderConditionGuide();
      startGroundingBoot();
      initChristmasCountdown();
      initFestiveDecor();
      renderPassport();
      updateAdjustmentLetter();
      updateBattery();
      initSpoonTracker();

      var tactileSoundToggle = document.getElementById('chk-ui-sound');
      if (tactileSoundToggle) {
        try {
          tactileSoundToggle.checked = localStorage.getItem('audhme_tactile_sounds_enabled') === 'true';
        } catch (error) {}
        tactileSoundToggle.addEventListener('change', function() {
          try {
            localStorage.setItem('audhme_tactile_sounds_enabled', tactileSoundToggle.checked ? 'true' : 'false');
          } catch (error) {}
        });
      }

      const adjRecipient = document.getElementById('adjRecipient');
      if (adjRecipient) adjRecipient.addEventListener('change', updateAdjustmentLetter);
      const barrierChecks = document.querySelectorAll('#barrierCheckboxes input[type="checkbox"]');
      barrierChecks.forEach(cb => cb.addEventListener('change', updateAdjustmentLetter));
    });

    // Initialize Firebase
    const firebaseConfig = {
      apiKey: "AIzaSyBO3dJRsRDb011tFC37T3O6X7kUIBAJSW4",
      authDomain: "audhme-sanctuary-b73dd.firebaseapp.com",
      projectId: "audhme-sanctuary-b73dd",
      storageBucket: "audhme-sanctuary-b73dd.firebasestorage.app",
      messagingSenderId: "986253884870",
      appId: "1:986253884870:web:77935412b2171aeac746c7",
      measurementId: "G-C5Z47VWZ58"
    };

    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(error) {
      console.warn('Firebase auth persistence could not be enabled:', error.code || error.message);
    });
    const db = firebase.firestore();
    const storage = firebase.storage();
    const functions = firebase.app().functions('europe-west2');
    const GOOGLE_CLIENT_ID = '986253884870-senv7guo4ukpvrbccplb9l3o29ge6u1n.apps.googleusercontent.com';
    let googleSignInInitialized = false;
    const FOUNDER_AUTH_UID = '4grgpBnKA9ROGhxJ0MoPn3yP3MV2';
    function isFounderCopyExempt() {
      return !!(auth.currentUser && auth.currentUser.uid === FOUNDER_AUTH_UID);
    }

    function clearFounderAtmospherePreview() {
      founderAtmoPreview.time = 'auto';
      founderAtmoPreview.season = 'auto';
      founderAtmoPreview.holiday = 'auto';
      founderAtmoPreview.weather = 'auto';
      document.getElementById('admin-time-preview').value = 'auto';
      document.getElementById('admin-season-preview').value = 'auto';
      document.getElementById('admin-holiday-preview').value = 'auto';
      document.getElementById('admin-weather-preview').value = 'auto';
      applySanctuaryAtmosphere(true);
    }

    let activeStaffRole = null;
    let staffRoleUnsubscribe = null;
    let staffClaimReady = false;
    let staffClaimError = false;
    let staffClaimSyncVersion = 0;
    let viewingOwnProfile = false;
    let adminMemberRecords = [];
    let adminMemberCursor = null;
    let sitePolicySaveVersion = 0;

    function updateAdminAccess() {
      const founder = isFounderCopyExempt();
      const verified = viewingOwnProfile && !!auth.currentUser && staffClaimReady && (founder || activeStaffRole === 'admin' || activeStaffRole === 'moderator');
      const allowed = viewingOwnProfile && !!auth.currentUser && (founder || verified);
      const button = document.getElementById('founder-admin-button');
      button.classList.toggle('hidden', !allowed);
      document.getElementById('founder-preview-controls').classList.toggle('hidden', !founder);
      document.getElementById('owner-staff-management').classList.toggle('hidden', !founder);
      document.getElementById('verified-staff-controls').classList.toggle('hidden', !verified);
      document.getElementById('admin-atmosphere-policy').classList.toggle('hidden', !(verified && (founder || activeStaffRole === 'admin')));
      document.getElementById('staff-access-unavailable').classList.toggle('hidden', !founder || verified);
      document.getElementById('staff-access-message').textContent = staffClaimError
        ? 'Staff access could not be verified. The local atmosphere preview is still available; staff controls require the backend to be available.'
        : 'Checking staff access… The local atmosphere preview is available.';
      document.getElementById('staff-access-retry').classList.toggle('hidden', !staffClaimError);
      if (!verified) {
        adminMemberRecords = [];
        document.getElementById('admin-member-list').replaceChildren();
        document.getElementById('admin-audit-list').replaceChildren();
        document.getElementById('admin-quarantine-list').replaceChildren();
      }
      if (!allowed) {
        document.getElementById('founder-admin-panel').classList.add('hidden');
        button.setAttribute('aria-expanded', 'false');
      }
    }

    function toggleFounderAdminPanel() {
      if (!viewingOwnProfile || !auth.currentUser || !(isFounderCopyExempt() || (staffClaimReady && (activeStaffRole === 'admin' || activeStaffRole === 'moderator')))) {
        showToast('Staff access is required.');
        return;
      }
      var panel = document.getElementById('founder-admin-panel');
      var button = document.getElementById('founder-admin-button');
      var opening = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !opening);
      button.setAttribute('aria-expanded', String(opening));
      if (opening && isFounderCopyExempt() && staffClaimReady) loadStaffList();
      if (opening && staffClaimReady) loadGalleryQuarantine();
    }

    function retryStaffAccess() {
      if (auth.currentUser && isFounderCopyExempt()) syncStaffClaim(auth.currentUser, 'owner');
    }

    async function syncStaffClaim(user, expectedRole) {
      const version = ++staffClaimSyncVersion;
      staffClaimReady = false;
      staffClaimError = false;
      updateAdminAccess();
      try {
        const existingToken = await user.getIdTokenResult();
        if (version !== staffClaimSyncVersion || !auth.currentUser || auth.currentUser.uid !== user.uid) return;
        if (!expectedRole && !existingToken.claims.role) return;
        const result = await functions.httpsCallable('syncMyStaffClaim')({});
        const token = await user.getIdTokenResult(true);
        if (version !== staffClaimSyncVersion || !auth.currentUser || auth.currentUser.uid !== user.uid) return;
        if (result.data.role !== expectedRole || (token.claims.role || null) !== expectedRole) {
          throw new Error('Staff role changed while the token was being refreshed.');
        }
        staffClaimReady = true;
        updateAdminAccess();
        if (isFounderCopyExempt() && !document.getElementById('founder-admin-panel').classList.contains('hidden')) loadStaffList();
      } catch (error) {
        if (version !== staffClaimSyncVersion || !auth.currentUser || auth.currentUser.uid !== user.uid) return;
        console.error('Staff claim synchronization failed:', error.code || error.message);
        staffClaimError = true;
        if (!isFounderCopyExempt()) showToast('Staff access could not be verified. Sign out and back in to retry.');
        updateAdminAccess();
      }
    }

    function renderAdminMembers() {
      const query = document.getElementById('admin-member-search').value.trim().toLowerCase();
      const list = document.getElementById('admin-member-list');
      list.replaceChildren();
      const visible = adminMemberRecords.filter(function(profile) {
        return (profile.uid + ' ' + profile.username + ' ' + (profile.displayName || '')).toLowerCase().includes(query);
      });
      if (!visible.length) { list.textContent = 'No loaded profiles match.'; return; }
      visible.forEach(function(profile) {
        const row = document.createElement('section');
        row.className = 'staff-list-entry';
        const heading = document.createElement('p');
        heading.textContent = (profile.displayName || profile.username || 'Unnamed') + ' (' + profile.uid + ') — ' +
          (profile.communityVisible ? 'Shared' : 'Private') + ' — ' +
          (profile.neurotypes.length ? profile.neurotypes.join(', ') : 'No neurotypes selected');
        row.appendChild(heading);
        (Array.isArray(profile.interestMedia) ? profile.interestMedia : []).forEach(function(item) {
          if (!item || typeof item.path !== 'string' || (activeStaffRole === 'moderator' &&
              (item.visibility === 'private' || item.archived || !profile.communityVisible))) return;
          const action = document.createElement('button');
          action.type = 'button';
          action.className = 'calm-secondary-button';
          action.textContent = 'Quarantine ' + (item.name || item.path.split('/').pop());
          action.addEventListener('click', function() { quarantineGalleryItem(profile.uid, item.path, action); });
          row.appendChild(action);
        });
        list.appendChild(row);
      });
    }

    async function quarantineGalleryItem(uid, path, button) {
      if (!staffClaimReady || !(isFounderCopyExempt() || activeStaffRole === 'admin' || activeStaffRole === 'moderator')) return;
      const reason = window.prompt('Why is this gallery item being quarantined?');
      if (reason === null) return;
      if (!reason.trim() || reason.trim().length > 500) {
        showToast('Enter a reason of 1–500 characters.');
        return;
      }
      button.disabled = true;
      try {
        await functions.httpsCallable('quarantineGalleryItem')({ uid: uid, path: path, reason: reason.trim() });
        showToast('Item quarantined. Its download token was revoked.');
        await Promise.all([loadGalleryQuarantine(), loadAdminMembers(true)]);
      } catch (error) {
        console.error('Gallery quarantine failed:', error.code || error.message);
        showToast(error.message || 'The gallery item could not be quarantined.');
      } finally { button.disabled = false; }
    }

    async function loadGalleryQuarantine() {
      const list = document.getElementById('admin-quarantine-list');
      if (!staffClaimReady || !(isFounderCopyExempt() || activeStaffRole === 'admin' || activeStaffRole === 'moderator')) return;
      const user = auth.currentUser;
      if (!user) return;
      list.textContent = 'Loading quarantined items…';
      try {
        const result = await functions.httpsCallable('listGalleryQuarantine')({});
        if (!auth.currentUser || auth.currentUser.uid !== user.uid || !staffClaimReady) return;
        list.replaceChildren();
        if (!result.data.items.length) { list.textContent = 'No quarantined items are available to review.'; return; }
        result.data.items.forEach(function(item) {
          const row = document.createElement('div');
          row.className = 'staff-list-entry';
          const label = document.createElement('p');
          const expiry = item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : 'expiry unavailable';
          const status = item.status === 'quarantining' ? 'quarantine needs retry' :
            item.status === 'restoring' ? 'restore needs retry' : 'permanent deletion after ' + expiry;
          label.textContent = (item.name || item.path) + ' — account ' + item.uid + ' — ' +
            item.reason + ' — ' + status;
          row.appendChild(label);
          const action = document.createElement('button');
          action.type = 'button';
          action.className = 'calm-secondary-button';
          const retryQuarantine = item.status === 'quarantining';
          action.textContent = retryQuarantine ? 'Retry quarantine' :
            item.status === 'restoring' ? 'Resume restore' : 'Restore';
          action.addEventListener('click', async function() {
            action.disabled = true;
            try {
              if (retryQuarantine) {
                await functions.httpsCallable('quarantineGalleryItem')({
                  uid: item.uid, path: item.path, reason: item.reason
                });
                showToast('Gallery quarantine completed.');
              } else {
                await functions.httpsCallable('restoreGalleryItem')({ uid: item.uid, id: item.id });
                showToast('Gallery item restored.');
              }
              await Promise.all([loadGalleryQuarantine(), loadAdminMembers(true)]);
            } catch (error) {
              console.error('Gallery moderation action failed:', error.code || error.message);
              showToast(error.message || 'The gallery action could not be completed.');
            } finally { action.disabled = false; }
          });
          row.appendChild(action);
          list.appendChild(row);
        });
      } catch (error) {
        console.error('Gallery quarantine queue failed:', error.code || error.message);
        list.textContent = 'Quarantined items could not be loaded.';
      }
    }

    async function saveSiteAtmospherePolicy() {
      if (!viewingOwnProfile || !staffClaimReady ||
          !(isFounderCopyExempt() || activeStaffRole === 'admin')) return;
      const status = document.getElementById('admin-atmosphere-policy-status');
      const controls = [
        ['admin-policy-local-time', 'localTime'],
        ['admin-policy-calendar-season', 'calendarSeason'],
        ['admin-policy-calendar-holiday', 'calendarHoliday'],
        ['admin-policy-live-weather', 'liveWeather']
      ];
      const policy = {};
      controls.forEach(function(entry) {
        const control = document.getElementById(entry[0]);
        policy[entry[1]] = control.checked;
        control.disabled = true;
      });
      const version = ++sitePolicySaveVersion;
      status.textContent = 'Saving shared atmosphere policy…';
      try {
        await functions.httpsCallable('updateSiteAtmospherePolicy')({ policy: policy });
        if (version !== sitePolicySaveVersion) return;
        siteAtmoPolicy = policy;
        siteAtmoPolicyStatus = 'Shared atmosphere policy saved.';
        updateSiteAtmosphereControls();
        applySanctuaryAtmosphere(true);
      } catch (error) {
        if (version !== sitePolicySaveVersion) return;
        console.error('Shared atmosphere policy update failed:', error.code || error.message);
        siteAtmoPolicyStatus = error.message || 'Shared atmosphere policy could not be saved.';
        updateSiteAtmosphereControls();
      } finally {
        if (version === sitePolicySaveVersion) {
          controls.forEach(function(entry) { document.getElementById(entry[0]).disabled = false; });
        }
      }
    }

    async function loadAdminMembers(reset) {
      const list = document.getElementById('admin-member-list');
      const user = auth.currentUser;
      const requestedRole = isFounderCopyExempt() ? 'owner' : activeStaffRole;
      if (!user || !(isFounderCopyExempt() || activeStaffRole === 'admin' || activeStaffRole === 'moderator')) return;
      if (reset) {
        adminMemberRecords = [];
        adminMemberCursor = null;
        document.getElementById('admin-member-next').classList.add('hidden');
      }
      list.textContent = 'Loading profiles…';
      try {
        const result = await functions.httpsCallable('listModerationProfiles')({ cursor: adminMemberCursor });
        if (!auth.currentUser || auth.currentUser.uid !== user.uid || requestedRole !== (isFounderCopyExempt() ? 'owner' : activeStaffRole)) return;
        adminMemberRecords = adminMemberRecords.concat(result.data.profiles);
        adminMemberCursor = result.data.nextCursor;
        document.getElementById('admin-member-next').classList.toggle('hidden', !adminMemberCursor);
        renderAdminMembers();
      } catch (error) {
        console.error('Profile audit failed:', error.code || error.message);
        list.textContent = 'Profiles could not be loaded. Check permissions and backend deployment.';
      }
    }

    async function loadAdminAudit() {
      if (!isFounderCopyExempt()) return;
      const list = document.getElementById('admin-audit-list');
      list.textContent = 'Loading audit activity…';
      try {
        const result = await functions.httpsCallable('listAdminAudit')({});
        if (!isFounderCopyExempt()) return;
        list.replaceChildren();
        if (!result.data.entries.length) { list.textContent = 'No audit activity yet.'; return; }
        result.data.entries.forEach(function(entry) {
          const row = document.createElement('p');
          row.textContent = (entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Time pending') + ' — ' + entry.action + ' — ' + entry.actor + ' → ' + entry.target;
          list.appendChild(row);
        });
      } catch (error) {
        console.error('Audit list failed:', error.code || error.message);
        list.textContent = 'Audit activity could not be loaded.';
      }
    }

    async function runStaffDiagnostics() {
      const user = auth.currentUser;
      const role = isFounderCopyExempt() ? 'owner' : activeStaffRole;
      if (!user || !['owner', 'admin', 'moderator'].includes(role)) return;
      const target = document.getElementById('admin-diagnostics');
      target.textContent = 'Checking…';
      const start = performance.now();
      try {
        const result = await functions.httpsCallable('staffDiagnostics')({});
        if (!auth.currentUser || auth.currentUser.uid !== user.uid || role !== (isFounderCopyExempt() ? 'owner' : activeStaffRole)) return;
        const data = result.data;
        target.replaceChildren();
        [
          'Authentication: ' + data.auth,
          'Firestore: ' + data.firestore + ' (' + data.firestoreMilliseconds + ' ms server-side).',
          'Callable round trip: ' + Math.round(performance.now() - start) + ' ms.',
          'Storage: ' + data.storage,
          'Security rules: ' + data.securityRules,
          'Weather: ' + (atmoState.weather === 'live' ? (liveWeatherStatus || 'Not checked yet.') : 'Live weather is not selected.') + (liveWeatherDiagnostic ? ' Details: ' + liveWeatherDiagnostic : '')
        ].forEach(function(text) {
          const line = document.createElement('p');
          line.textContent = text;
          target.appendChild(line);
        });
      } catch (error) {
        console.error('Staff diagnostics failed:', error.code || error.message);
        target.textContent = 'Diagnostics failed. This does not identify which service is unavailable; check the console and Firebase logs.';
      }
    }

    let staffInboxUnsubscribe = null;
    let staffUnreadUnsubscribe = null;
    function toggleProfileInbox() {
      if (!auth.currentUser || !currentUser || currentUser.uid !== auth.currentUser.uid) return;
      const panel = document.getElementById('profile-inbox');
      const opening = panel.classList.contains('hidden');
      panel.classList.toggle('hidden', !opening);
      document.getElementById('profile-inbox-button').setAttribute('aria-expanded', String(opening));
    }

    function listenForStaffInbox(user) {
      if (staffInboxUnsubscribe) staffInboxUnsubscribe();
      if (staffUnreadUnsubscribe) staffUnreadUnsubscribe();
      staffInboxUnsubscribe = null;
      staffUnreadUnsubscribe = null;
      document.getElementById('profile-inbox-count').textContent = '';
      document.getElementById('profile-inbox-items').textContent = 'Loading notifications…';
      if (!user) return;
      staffUnreadUnsubscribe = db.collection('users').doc(user.uid).collection('notifications').where('read', '==', false).limit(101).onSnapshot(function(snapshot) {
        if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
        const unread = snapshot.size;
        document.getElementById('profile-inbox-count').textContent = unread ? '(' + (unread > 100 ? '100+' : unread) + ')' : '';
      }, function(error) {
        console.error('Unread notification count failed:', error.code || error.message);
        document.getElementById('profile-inbox-count').textContent = '(!)';
      });
      staffInboxUnsubscribe = db.collection('users').doc(user.uid).collection('notifications').orderBy('createdAt', 'desc').limit(100).onSnapshot(function(snapshot) {
        if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
        const container = document.getElementById('profile-inbox-items');
        container.replaceChildren();
        if (snapshot.empty) { container.textContent = 'No notifications yet.'; return; }
        snapshot.docs.forEach(function(doc) {
          const item = doc.data();
          const row = document.createElement('div');
          row.className = 'profile-inbox-entry';
          const text = document.createElement('span');
          text.textContent = item.type === 'staff-invitation' ? 'Staff invitation: ' + item.role + (item.status ? ' (' + item.status + ')' : '') : item.type === 'staff-revoked' ? 'Your staff access or invitation has been revoked.' : item.type === 'staff-role-changed' ? 'Your staff role is now ' + item.role + '.' : 'Notification';
          row.appendChild(text);
          if (item.type === 'staff-invitation' && !item.status) {
            [true, false].forEach(function(accept) {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = 'calm-secondary-button';
              button.textContent = accept ? 'Accept' : 'Decline';
              button.addEventListener('click', async function() {
                button.disabled = true;
                try {
                  await functions.httpsCallable('respondStaffInvitation')({ invitationId: item.invitationId, accept: accept });
                  showToast(accept ? 'Staff invitation accepted.' : 'Staff invitation declined.');
                } catch (error) {
                  console.error('Staff invitation response failed:', error.code || error.message);
                  showToast(error.message || 'Unable to respond to the invitation.');
                } finally { button.disabled = false; }
              });
              row.appendChild(button);
            });
          } else if (item.read === false) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'calm-secondary-button';
            button.textContent = 'Mark read';
            button.addEventListener('click', async function() {
              button.disabled = true;
              try {
                await functions.httpsCallable('markStaffNotificationRead')({ notificationId: doc.id });
              } catch (error) {
                console.error('Unable to mark notification read:', error.code || error.message);
                showToast('Unable to mark the notification as read.');
                button.disabled = false;
              }
            });
            row.appendChild(button);
          }
          container.appendChild(row);
        });
      }, function(error) {
        console.error('Staff inbox failed:', error.code || error.message);
        document.getElementById('profile-inbox-items').textContent = 'Notifications could not be loaded. Please try again later.';
        document.getElementById('profile-inbox-count').textContent = '(!)';
      });
    }

    async function submitStaffInvite(event) {
      event.preventDefault();
      if (!isFounderCopyExempt()) { showToast('Only the owner can invite staff.'); return; }
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        await functions.httpsCallable('inviteStaff')({ email: document.getElementById('staff-invite-email').value, role: document.getElementById('staff-invite-role').value });
        form.reset();
        document.getElementById('staff-management-status').textContent = 'Invitation sent to the member’s inbox.';
        await loadStaffList();
      } catch (error) {
        console.error('Staff invitation failed:', error.code || error.message);
        document.getElementById('staff-management-status').textContent = error.message || 'Unable to send the invitation.';
      } finally { button.disabled = false; }
    }

    async function loadStaffList() {
      if (!isFounderCopyExempt()) return;
      const list = document.getElementById('staff-management-list');
      list.textContent = 'Loading staff…';
      try {
        const result = await functions.httpsCallable('listStaff')({});
        if (!isFounderCopyExempt()) return;
        list.replaceChildren();
        const entries = result.data.members.map(function(member) { return { uid: member.uid, name: member.name, role: member.role, status: 'active' }; })
          .concat(result.data.invitations.map(function(invite) { return { uid: invite.uid, name: invite.name, role: invite.role, status: 'invited' }; }));
        if (!entries.length) { list.textContent = 'No staff or pending invitations.'; return; }
        entries.forEach(function(entry) {
          const row = document.createElement('div');
          row.className = 'staff-list-entry';
          const text = document.createElement('span');
          text.textContent = (entry.name || 'Unnamed member') + ' — ' + entry.role + ' (' + entry.status + ')';
          const uid = document.createElement('small');
          uid.textContent = entry.uid;
          text.appendChild(document.createElement('br'));
          text.appendChild(uid);
          if (entry.uid === FOUNDER_AUTH_UID) {
            row.appendChild(text);
            list.appendChild(row);
            return;
          }
          if (entry.status === 'active') {
            const change = document.createElement('button');
            change.type = 'button';
            change.className = 'calm-secondary-button';
            const nextRole = entry.role === 'admin' ? 'moderator' : 'admin';
            change.textContent = 'Change to ' + nextRole;
            change.addEventListener('click', async function() {
              if (!window.confirm('Change this member’s role to ' + nextRole + '?')) return;
              change.disabled = true;
              try {
                await functions.httpsCallable('changeStaffRole')({ uid: entry.uid, role: nextRole });
                document.getElementById('staff-management-status').textContent = 'Staff role updated.';
                await loadStaffList();
              } catch (error) {
                console.error('Staff role change failed:', error.code || error.message);
                document.getElementById('staff-management-status').textContent = error.message || 'Unable to change staff role.';
                change.disabled = false;
              }
            });
            row.appendChild(change);
          }
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'calm-secondary-button'; button.textContent = 'Revoke';
          button.addEventListener('click', async function() {
            if (!window.confirm('Revoke this member’s staff access and pending invitations?')) return;
            button.disabled = true;
            try {
              await functions.httpsCallable('revokeStaff')({ uid: entry.uid });
              document.getElementById('staff-management-status').textContent = 'Staff access revoked.';
              await loadStaffList();
            } catch (error) {
              console.error('Staff revocation failed:', error.code || error.message);
              document.getElementById('staff-management-status').textContent = error.message || 'Unable to revoke staff access.';
              button.disabled = false;
            }
          });
          row.append(text, button); list.appendChild(row);
        });
      } catch (error) {
        console.error('Staff list failed:', error.code || error.message);
        list.textContent = 'Staff list unavailable. The staff backend may not be deployed.';
      }
    }

    function setFounderAtmospherePreview(kind, value) {
      var allowed = {
        time: ['auto', 'morning', 'afternoon', 'evening', 'night'],
        season: ['auto', 'none', 'spring', 'summer', 'autumn', 'winter'],
        holiday: ['auto', 'none', 'founders-day', 'halloween', 'bonfire', 'christmas', 'new-year', 'valentines', 'easter'],
        weather: ['auto', 'seasonal', 'clear', 'rain', 'snow', 'mist', 'off']
      };
      if (!isFounderCopyExempt() || !allowed[kind] || !allowed[kind].includes(value)) {
        showToast('Unable to apply this administrator preview.');
        return;
      }
      founderAtmoPreview[kind] = value;
      applySanctuaryAtmosphere(true);
    }

    function resetFounderAtmospherePreview() {
      if (!isFounderCopyExempt()) {
        showToast('Administrator preview is only available to the founder account.');
        return;
      }
      clearFounderAtmospherePreview();
    }

    ['copy', 'cut', 'paste', 'contextmenu', 'dragstart', 'selectstart'].forEach(function(eventName) {
      document.addEventListener(eventName, function(event) {
        if (isFounderCopyExempt()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    });

    document.addEventListener('keydown', function(event) {
      if (isFounderCopyExempt() || !(event.ctrlKey || event.metaKey)) return;
      if (['c', 'x', 'v'].includes(String(event.key || '').toLowerCase())) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    const CART_STORAGE_KEY = 'audhme_cart_v1';
    const CART_PRODUCTS = {
      'core-hoodie': { name: 'The AuDHMe™ Core Hoodie', price: 39.99, sizes: ['S', 'M', 'L'], colors: ['Black', 'Navy Blazer', 'Charcoal Heather', 'Vintage Black', 'Forest Green', 'White'] },
      'spectrum-hoodie': { name: 'The Spectrum Hoodie', price: 39.99, sizes: ['S', 'M', 'L'], colors: ['Black', 'White'] },
      'spectrum-hoodie-black': { name: 'The Spectrum Hoodie', price: 39.99, sizes: ['S', 'M', 'L'], colors: ['Black', 'White'], canonicalSku: 'spectrum-hoodie', defaultColor: 'Black' },
      'spectrum-hoodie-white': { name: 'The Spectrum Hoodie', price: 39.99, sizes: ['S', 'M', 'L'], colors: ['Black', 'White'], canonicalSku: 'spectrum-hoodie', defaultColor: 'White' }
    };

    function normalizeCart(value) {
      if (!Array.isArray(value)) return [];
      return value.slice(0, 10).reduce(function(items, item) {
        if (!item || typeof item !== 'object') return items;
        const sku = item.sku || '';
        const product = CART_PRODUCTS[sku];
        const size = String(item.size || 'L').toUpperCase();
        const canonicalSku = product && (product.canonicalSku || sku);
        const canonicalProduct = canonicalSku && CART_PRODUCTS[canonicalSku];
        const color = String(item.color || product && product.defaultColor || canonicalProduct && canonicalProduct.colors[0] || '').trim();
        if (!product || !canonicalProduct || !canonicalProduct.sizes.includes(size) || !canonicalProduct.colors.includes(color)) return items;
        items.push({ sku: canonicalSku, size: size, color: color });
        return items;
      }, []);
    }

    function persistCart() {
      try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
      } catch (error) {
        console.warn('Basket could not be saved in this browser:', error);
      }
    }

    function loadCart() {
      try {
        const saved = localStorage.getItem(CART_STORAGE_KEY) || localStorage.getItem('test_cart');
        return normalizeCart(saved ? JSON.parse(saved) : []);
      } catch (error) {
        console.warn('Saved basket was unreadable and has been reset.');
        return [];
      }
    }

    let cart = loadCart();
    let checkoutInProgress = false;
    let checkoutReturnHandled = false;
    let userProfileReady = Promise.resolve();
    persistCart();
    let currentUser = null;
    let resolveAuthInitialized;
    const authInitialized = new Promise(function(resolve) { resolveAuthInitialized = resolve; });

    function finishCheckoutReturn() {
      if (checkoutReturnHandled) return;
      const params = new URLSearchParams(window.location.search);
      const result = params.get('checkout');
      if (!result) return;
      if (result === 'cancelled') {
        checkoutReturnHandled = true;
        history.replaceState(null, '', window.location.pathname + window.location.hash);
        if (auth.currentUser) {
          db.collection('users').doc(auth.currentUser.uid).get().then(function(snapshot) {
            if (snapshot.exists && currentUser && currentUser.uid === auth.currentUser.uid) {
              const profile = snapshot.data();
              currentUser.perkRedeemedAt = profile.perkRedeemedAt || null;
              currentUser.perkReservationId = profile.perkReservationId || null;
              updateUI();
            }
          }).catch(function() {});
        }
        showToast('Checkout cancelled. Your basket is still saved.');
        return;
      }
      if (result !== 'success' || !params.get('session_id') || !auth.currentUser) return;
      checkoutReturnHandled = true;
      functions.httpsCallable('verifyCheckoutSession')({ sessionId: params.get('session_id') })
        .then(function(response) {
          history.replaceState(null, '', window.location.pathname + window.location.hash);
          if (!response.data || !response.data.paid) {
            showToast('Payment has not been confirmed yet. Your basket is still saved.');
            return;
          }
          if (currentUser && auth.currentUser && currentUser.uid === auth.currentUser.uid) {
            currentUser.perkRedeemedAt = currentUser.perkRedeemedAt || Date.now();
            currentUser.perkReservationId = null;
          }
          cart = [];
          persistCart();
          updateUI();
          const cartModal = document.getElementById('cart-modal');
          if (cartModal && !cartModal.classList.contains('hidden')) renderCartItems();
          showToast('Payment confirmed. Thank you for supporting AuDHMe.');
        })
        .catch(function(error) {
          console.error('Checkout return verification failed:', error.code || error.message);
          showToast('Payment is processing. Your basket will clear after confirmation.');
        });
    }

    let authStateVersion = 0;
    auth.onAuthStateChanged(function(user) {
      closeGalleryViewer();
      closeProfileStatusForNavigation();
      directoryProfiles = null;
      directoryLoadError = null;
      directoryRenderVersion++;
      if (staffRoleUnsubscribe) staffRoleUnsubscribe();
      staffRoleUnsubscribe = null;
      staffClaimSyncVersion++;
      staffClaimReady = false;
      staffClaimError = false;
      activeStaffRole = null;
      viewingOwnProfile = false;
      updateAdminAccess();
      if (user && user.uid !== FOUNDER_AUTH_UID) {
        staffRoleUnsubscribe = db.collection('staffRoles').doc(user.uid).onSnapshot(function(snapshot) {
          if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
          const nextRole = snapshot.exists && ['admin', 'moderator'].includes(snapshot.data().role) ? snapshot.data().role : null;
          if (nextRole !== activeStaffRole) {
            adminMemberRecords = [];
            adminMemberCursor = null;
            document.getElementById('admin-member-list').replaceChildren();
            document.getElementById('founder-admin-panel').classList.add('hidden');
            document.getElementById('founder-admin-button').setAttribute('aria-expanded', 'false');
          }
          activeStaffRole = nextRole;
          updateAdminAccess();
          syncStaffClaim(user, nextRole);
        }, function(error) {
          console.error('Staff role could not be loaded:', error.code || error.message);
          staffClaimSyncVersion++;
          staffClaimReady = false;
          activeStaffRole = null;
          updateAdminAccess();
        });
      }
      if (user && user.uid === FOUNDER_AUTH_UID) syncStaffClaim(user, 'owner');
      listenForStaffInbox(user);
      document.getElementById('profile-inbox').classList.add('hidden');
      document.getElementById('profile-inbox-button').classList.add('hidden');
      document.getElementById('profile-inbox-button').setAttribute('aria-expanded', 'false');
      if (resolveAuthInitialized) {
        resolveAuthInitialized();
        resolveAuthInitialized = null;
      }
      document.body.classList.toggle('copy-protection-enabled', !(user && user.uid === FOUNDER_AUTH_UID));
      if (!user || user.uid !== FOUNDER_AUTH_UID) {
        document.getElementById('founder-admin-button').classList.add('hidden');
        document.getElementById('founder-admin-button').setAttribute('aria-expanded', 'false');
        document.getElementById('founder-admin-panel').classList.add('hidden');
        clearFounderAtmospherePreview();
      }
      const version = ++authStateVersion;
      if (!user) {
        currentUser = null;
        updateUI();
        finishCheckoutReturn();
        return;
      }

      currentUser = null;
      updateUI();
      const profileRef = db.collection('users').doc(user.uid);
      userProfileReady = profileRef.get().then(function(snapshot) {
        if (version !== authStateVersion || !auth.currentUser || auth.currentUser.uid !== user.uid) return;
        const saved = snapshot.exists ? snapshot.data() : {};
        const isFounderAccount = user.uid === FOUNDER_AUTH_UID;
        const savedBio = typeof saved.bio === 'string' ? saved.bio : (isFounderAccount ? 'Founder of AuDHMe' : '');
        currentUser = {
          uid: user.uid,
          email: user.email || '',
          username: typeof saved.username === 'string' && saved.username.trim() ? saved.username.trim() : (user.displayName || (user.email || '').split('@')[0]),
          displayName: typeof saved.displayName === 'string' && saved.displayName.trim() ? saved.displayName.trim().slice(0,40) : null,
          avatar: typeof saved.avatar === 'string' ? saved.avatar : (user.photoURL || null),
          bio: isFounderAccount ? savedBio : (savedBio === 'Founder of AuDHMe' ? '' : savedBio),
          neurotypes: Array.isArray(saved.neurotypes) ? saved.neurotypes.filter(function(type) { return availableNeurotypes.includes(type); }) : [],
          liveStatuses: validProfileStatuses(saved.liveStatuses),
          links: Array.isArray(saved.links) ? saved.links : [],
          interestMedia: Array.isArray(saved.interestMedia) ? saved.interestMedia.slice(0, 12) : [],
          communityVisible: !snapshot.exists || saved.communityVisible === true,
          lastUsernameChange: Number(saved.lastUsernameChange) || null,
          perkRedeemedAt: saved.perkRedeemedAt || null,
          perkReservationId: saved.perkReservationId || null
        };
        if (!snapshot.exists) {
          return persistUserProfile().then(function() { if(version===authStateVersion){updateUI();finishCheckoutReturn();} });
        }
        return syncCommunityProfile(currentUser).catch(function(error) {
          console.error('Community profile sync failed:',error.code||error.message);
          showToast('Community sharing could not be refreshed. Please check your connection.');
        }).then(function(){if(version===authStateVersion){updateUI();finishCheckoutReturn();}});
      }).catch(function(error) {
        if (version !== authStateVersion) return;
        console.error('Error loading private user profile:', error.code || error.message);
        currentUser = {
          uid: user.uid,
          email: user.email || '',
          username: user.displayName || (user.email || '').split('@')[0],
          displayName: null,
          avatar: user.photoURL || null,
          bio: '', neurotypes: [], links: [], interestMedia: [], communityVisible: false, perkRedeemedAt: null
        };
        updateUI();
        finishCheckoutReturn();
        showToast('Your account is signed in, but the private profile could not be loaded.');
      });
    });
    let isLoginMode = false;
    let tempAuthEmail = null;
    let isSearchOpen = false;
    let searchAuthPrompt = false;

    const availableNeurotypes = [
      "AuDHD (Autism + ADHD)", "Autism / Autistic Spectrum", "ADHD (Attention Deficit Hyperactivity Disorder)",
      "Dyslexia", "Dyscalculia", "Dyspraxia / DCD", "Dysgraphia", "Sensory Processing Difference / Sensitivity",
      "Synesthesia", "Obsessive-Compulsive Profile (OCD)", "Tourette Syndrome / Tic Profile",
      "AuDHD + Dyslexia / Learning Difference", "Neurodivergent Explorer / Self-Discovering", "Hypermobility / HSD / EDS", "Ally / Supporter / Family"
    ];

    function renderCheckboxList(containerId, selectedValues = []) {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.innerHTML = availableNeurotypes.map((type) => {
        const isChecked = selectedValues.includes(type) ? 'checked' : '';
        return '<label class="flex items-center gap-2.5 cursor-pointer hover:text-white">' +
          '<input type="checkbox" name="neurotype-option" value="' + type + '" ' + isChecked + ' class="rounded bg-slate-800 border-slate-600 text-amber-400 focus:ring-0">' +
          '<span>' + type + '</span>' +
        '</label>';
      }).join('');
    }

    function getSelectedCheckboxes(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return [];
      const checkboxes = container.querySelectorAll('input[name="neurotype-option"]:checked');
      return Array.from(checkboxes).map(cb => cb.value);
    }

    function updateUI() {
      const countEl = document.getElementById('cart-count');
      if (countEl) countEl.textContent = cart.length;
      
      const userDisplay = document.getElementById('user-display');
      if (!userDisplay) return;
      
      const button = document.createElement('button');
      button.className = currentUser
        ? 'px-3 py-1.5 rounded-lg bg-[#303329] border border-[#cbb678]/40 text-xs font-bold text-[#cbb678] hover:border-[#cbb678] transition flex items-center gap-1.5'
        : 'px-3 py-1.5 rounded-lg bg-[#303329] border border-slate-700 text-xs font-bold text-sky-300 hover:border-sky-400';
      button.type = 'button';
      button.addEventListener('click', function() {
        if (currentUser) switchView('profile');
        else openAuthModal('signup');
      });
      const buttonLabel = currentUser ? (currentUser.displayName || currentUser.username || currentUser.email.split('@')[0]) : 'Sign Up / In';
      button.setAttribute('aria-label', buttonLabel);
      button.innerHTML = '<i class="fa-regular fa-circle-user" aria-hidden="true"></i><span></span>';
      button.querySelector('span').textContent = buttonLabel;
      userDisplay.replaceChildren(button);
    }

    function safeProfileUrl(value) {
      try {
        const url = new URL(String(value), window.location.origin);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
      } catch (e) {
        return null;
      }
    }

    function safeProfileAvatarUrl(value) {
      const valueString = String(value || '');
      if (valueString.startsWith('data:image/')) {
        return /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(valueString) ? valueString : null;
      }
      return safeProfileUrl(valueString);
    }

    function addProfileLink(container, link) {
      const url = safeProfileUrl(link.url);
      if (!url) return;
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.className = 'px-3 py-1.5 rounded-xl bg-[#303329] border border-slate-700 hover:border-[#cbb678] text-xs font-bold text-sky-300 transition flex items-center gap-1.5 shadow-sm';
      anchor.textContent = '🔗 ' + String(link.label || 'Profile link');
      container.appendChild(anchor);
    }

    function switchView(viewName, updateHistory) {
      closeGalleryViewer();
      closeProfileStatusForNavigation();
      if (viewName === 'profile' && (!currentUser || !auth.currentUser || currentUser.uid !== auth.currentUser.uid)) {
        openAuthModal('signup');
        return;
      }
      if (viewName === 'directory' && !auth.currentUser) {
        searchAuthPrompt = isSearchOpen;
        openAuthModal('signup');
        return;
      }
      if (viewName === 'confessions' && !auth.currentUser) {
        openAuthModal('signup');
        return;
      }

      routeVersion++;
      hideRouteLoading();
      var allEmbeds = ['embed03','embed35','embed-store','embed13','embed09','embed41','embed07','embed06','embed11','embed04','embed15','embed16'];
      allEmbeds.forEach(function(id) { var el=document.getElementById(id); if (el) el.classList.remove('active-embed'); });
      const profilePage=document.getElementById('profile-page'), directoryView=document.getElementById('directory-view');
      if (profilePage) { profilePage.classList.add('hidden'); profilePage.classList.remove('active-embed'); profilePage.style.display='none'; }
      if (directoryView) { directoryView.classList.add('hidden'); directoryView.classList.remove('active-embed'); directoryView.style.display='none'; }
      var confessionsViewSv=document.getElementById('confessions-view'); if(confessionsViewSv){confessionsViewSv.classList.add('hidden');confessionsViewSv.classList.remove('active-embed');confessionsViewSv.style.display='none';}
      if (viewName==='profile') {
        updateSkipTarget('profile-page');
        if (profilePage) { profilePage.style.display='block'; profilePage.classList.remove('hidden'); profilePage.classList.add('active-embed'); }
        renderProfile(currentUser,true);
      } else if (viewName==='directory') {
        updateSkipTarget('directory-view');
        searchAuthPrompt = false;
        if (directoryView) { directoryView.style.display='block'; directoryView.classList.remove('hidden'); directoryView.classList.add('active-embed'); }
        const search=document.getElementById('member-search-input');
        renderCommunityDirectory(search ? search.value : '');
      } else if (viewName==='confessions') {
        updateSkipTarget('confessions-view');
        var cv=document.getElementById('confessions-view');
        if(cv){cv.style.display='block';cv.classList.remove('hidden');cv.classList.add('active-embed');}
        renderConfessions();
      } else { switchPage('home',true); return; }
      updateActiveNavigation(viewName);
      document.querySelectorAll('.audh-links').forEach(function(menu){menu.classList.remove('active');});
      var menuButton=document.querySelector('.audh-hamburger'); if(menuButton)menuButton.setAttribute('aria-expanded','false');
      document.querySelectorAll('.audh-links .group.open').forEach(function(group){group.classList.remove('open');var trigger=group.querySelector('[aria-haspopup="true"]');if(trigger)trigger.setAttribute('aria-expanded','false');});
      if (updateHistory!==false) { try { history.pushState(null,null,'#'+viewName); } catch(e) {} }
      window.scrollTo({top:0,behavior:'instant'});
    }

    function renderProfile(profile,isOwner) {
      profile=profile||currentUser; isOwner=isOwner!==false; if(!profile)return;
      closeGalleryViewer();
      const statusDialog=document.getElementById('profile-status-dialog');if(statusDialog.open)statusDialog.close();
      const usernameEl=document.getElementById('profile-display-username'); if(usernameEl) usernameEl.textContent=profile.displayName||profile.username||'Sanctuary member';
      const avatarWrap=document.getElementById('profile-view-avatar-wrap');
      if(avatarWrap) { const avatarUrl=safeProfileAvatarUrl(profile.avatar); if(avatarUrl) { const image=document.createElement('img'); image.src=avatarUrl; image.alt='Profile picture'; image.className='w-full h-full object-cover'; avatarWrap.replaceChildren(image); } else { const fallback=document.createElement('span'); fallback.className='text-3xl font-bold text-[#cbb678]'; fallback.textContent=(profile.displayName||profile.username||'A').charAt(0).toUpperCase(); avatarWrap.replaceChildren(fallback); } }
      const bioEl=document.getElementById('profile-view-bio'); if(bioEl) bioEl.textContent=profile.bio||'No bio added yet.';
      const types=document.getElementById('profile-view-neurotypes'); if(types) { types.replaceChildren(); const list=Array.isArray(profile.neurotypes)?profile.neurotypes:[]; if(!list.length) { const empty=document.createElement('span'); empty.className='text-xs text-slate-400 italic'; empty.textContent='No neurotypes selected'; types.appendChild(empty); } else list.forEach(function(type){const badge=document.createElement('span');badge.className='profile-neurotype-badge';badge.textContent=String(type);types.appendChild(badge);}); }
      const founder=profile.uid===FOUNDER_AUTH_UID, badges=document.getElementById('profile-header-badges'), card=document.getElementById('profile-public-view');
      if(card) card.classList.toggle('founder-profile',founder);
      if(badges) badges.innerHTML=(founder?'<span class="profile-founder-badge"><span>✨</span> Sanctuary Founder &amp; Architect</span>':'')+'<span class="profile-member-badge">Sanctuary Member</span>';
      renderProfileStatuses(profile,isOwner);
      const links=document.getElementById('profile-links-container'); if(links){links.replaceChildren();(Array.isArray(profile.links)?profile.links:[]).forEach(function(link){addProfileLink(links,link);});}
      const settings=document.getElementById('owner-settings-btn'); if(settings) settings.classList.toggle('hidden',!isOwner);
      document.getElementById('profile-inbox-button').classList.toggle('hidden', !isOwner);
      document.getElementById('profile-inbox').classList.add('hidden');
      document.getElementById('profile-inbox-button').setAttribute('aria-expanded', 'false');
      viewingOwnProfile = isOwner && !!auth.currentUser && profile.uid === auth.currentUser.uid;
      updateAdminAccess();
      document.getElementById('founder-admin-button').setAttribute('aria-expanded', 'false');
      document.getElementById('founder-admin-panel').classList.add('hidden');
      const back=document.getElementById('community-profile-back'); if(back) back.classList.toggle('hidden',isOwner);
      const context=document.getElementById('profile-context-label'); if(context) context.textContent=isOwner?'My Sanctuary profile':'Community member profile';
      const summary=document.getElementById('profile-privacy-summary'); if(summary) summary.textContent=isOwner?(profile.communityVisible?'Your profile is visible to signed-in Sanctuary members. Gallery items can still be kept private individually.':'Your profile and gallery are not shared with other members. Items marked for sharing will be visible if you share your profile again.'):'Shared by this member with signed-in Sanctuary members.';
      const perk=document.getElementById('owner-perk-box'); if(perk) perk.classList.toggle('hidden',!isOwner);
      const visibility=document.getElementById('profile-community-visible'); if(visibility) visibility.checked=isOwner&&profile.communityVisible===true;
      ['owner-profile-visibility','owner-gallery-controls'].forEach(function(id){const control=document.getElementById(id);if(control)control.classList.toggle('hidden',!isOwner);});
      if(!isOwner) document.querySelectorAll('#profile-gallery-archive[open]').forEach(function(details){details.open=false;});
      const detailsVisible=isOwner||profile.communityVisible===true;
      ['profile-bio-section','profile-neurotypes-section','profile-links-section'].forEach(function(id){const section=document.getElementById(id);if(section)section.classList.toggle('hidden',!detailsVisible);});
      renderPrivateInterestGallery(profile,isOwner);
      const publicView=document.getElementById('profile-public-view'); if(publicView) publicView.classList.remove('hidden');
      const settingsView=document.getElementById('profile-settings-view'); if(settingsView) settingsView.classList.add('hidden');
      const uploadView=document.getElementById('profile-gallery-upload-view'); if(uploadView) uploadView.classList.add('hidden');
    }

    function profileStatusCatalog() {
      return Array.from(document.querySelectorAll('.flip-card')).map(function(card) {
        const code=card.querySelector('.card-code-mini'), title=card.querySelector('.card-title-mini');
        const series=card.closest('.series-block-container'),heading=series&&series.querySelector('.series-node-title');
        return code ? {code:code.textContent.trim(),title:title ? title.textContent.trim() : 'Neuro-Code',category:heading ? heading.textContent.trim() : 'Other codes'} : null;
      }).filter(Boolean);
    }

    function validProfileStatuses(statuses) {
      const allowed=new Set(profileStatusCatalog().map(function(item){return item.code;}));
      return Array.isArray(statuses) ? Array.from(new Set(statuses.filter(function(code){return allowed.has(code);}))) : [];
    }

    function renderProfileStatuses(profile,isOwner) {
      const selected=validProfileStatuses(profile.liveStatuses), catalog=profileStatusCatalog();
      const display=document.getElementById('profile-live-status'), editor=document.getElementById('owner-status-editor'),section=document.getElementById('profile-status-section');
      section.hidden=!isOwner&&!selected.length;
      editor.classList.toggle('hidden',!isOwner);
      display.replaceChildren();
      if(!selected.length&&isOwner){const empty=document.createElement('p');empty.className='profile-status-placeholder';empty.textContent='No codes selected yet.';display.appendChild(empty);return;}
      function addBadge(code,target){const item=catalog.find(function(entry){return entry.code===code;});const badge=document.createElement('span');badge.className='profile-status-badge';badge.textContent=code+' · '+item.title;target.appendChild(badge);}
      selected.slice(0,3).forEach(function(code){addBadge(code,display);});
      if(selected.length>3){
        const more=document.createElement('details');more.className='profile-status-more';
        const summary=document.createElement('summary');summary.textContent='Show '+(selected.length-3)+' more';more.appendChild(summary);
        const extra=document.createElement('div');extra.className='profile-status-extra';selected.slice(3).forEach(function(code){addBadge(code,extra);});more.appendChild(extra);display.appendChild(more);
      }
    }

    function openProfileStatusEditor() {
      if(!auth.currentUser||!currentUser||auth.currentUser.uid!==currentUser.uid){showToast('Sign in to edit your status.');return;}
      if(profileChangePending){showToast('Please wait for the current profile change to finish.');return;}
      const dialog=document.getElementById('profile-status-dialog'),options=document.getElementById('profile-status-options');
      if(dialog.open)return;
      const selected=new Set(validProfileStatuses(currentUser.liveStatuses)),groups=new Map();
      options.replaceChildren();
      profileStatusCatalog().forEach(function(item){
        if(!groups.has(item.category)){const group=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=item.category;group.appendChild(legend);groups.set(item.category,group);options.appendChild(group);}
        const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span'),code=document.createElement('strong');
        label.className='profile-status-option';label.dataset.search=(item.code+' '+item.title+' '+item.category).toLowerCase();
        input.type='checkbox';input.value=item.code;input.checked=selected.has(item.code);input.addEventListener('change',updateProfileStatusSelectionCount);
        code.textContent=item.code;text.append(code,document.createTextNode(' '+item.title));label.append(input,text);groups.get(item.category).appendChild(label);
      });
      document.getElementById('profile-status-search').value='';
      document.getElementById('profile-status-error').textContent='';
      filterProfileStatusOptions();updateProfileStatusSelectionCount();
      try {dialog.showModal();document.getElementById('profile-status-search').focus();}
      catch(error){console.error('Status editor could not be opened:',error);showToast('The status editor could not be opened. Please try again.');}
    }

    function filterProfileStatusOptions() {
      const query=document.getElementById('profile-status-search').value.trim().toLowerCase();
      let total=0;
      document.querySelectorAll('#profile-status-options fieldset').forEach(function(group){
        let visible=0;group.querySelectorAll('.profile-status-option').forEach(function(option){const matches=option.dataset.search.includes(query);option.hidden=!matches;if(matches)visible++;});
        group.hidden=visible===0;total+=visible;
      });
      document.getElementById('profile-status-empty').hidden=total>0;
    }

    function updateProfileStatusSelectionCount() {
      const count=document.querySelectorAll('#profile-status-options input:checked').length;
      document.getElementById('profile-status-selection-count').textContent=count+' '+(count===1?'code selected':'codes selected');
      document.getElementById('profile-status-clear').disabled=count===0;
    }

    function clearProfileStatusSelection() {
      document.querySelectorAll('#profile-status-options input:checked').forEach(function(input){input.checked=false;});
      updateProfileStatusSelectionCount();
    }

    function closeProfileStatusEditor() {
      if(profileChangePending){document.getElementById('profile-status-error').textContent='Please wait for your status to finish saving.';return;}
      closeProfileStatusForNavigation();
    }

    function closeProfileStatusForNavigation() {
      const dialog=document.getElementById('profile-status-dialog');if(dialog&&dialog.open)dialog.close();
    }

    async function saveProfileStatuses() {
      const user=auth.currentUser, profile=currentUser;
      const errorMessage=document.getElementById('profile-status-error');
      if(!user||!profile||profile.uid!==user.uid){errorMessage.textContent='Sign in to save your status.';return;}
      if(profileChangePending){errorMessage.textContent='Please wait for the current profile change to finish.';return;}
      const previous=profile.liveStatuses;
      profile.liveStatuses=validProfileStatuses(Array.from(document.querySelectorAll('#profile-status-options input:checked')).map(function(input){return input.value;}));
      profileChangePending=true;
      const dialog=document.getElementById('profile-status-dialog'),button=document.getElementById('profile-status-save');
      const inputs=Array.from(document.querySelectorAll('#profile-status-options input'));
      const search=document.getElementById('profile-status-search'),clear=document.getElementById('profile-status-clear');
      button.disabled=true;search.disabled=true;clear.disabled=true;inputs.forEach(function(input){input.disabled=true;});errorMessage.textContent='';
      try {
        await persistUserProfile();
        if(currentUser===profile&&auth.currentUser&&auth.currentUser.uid===user.uid){renderProfileStatuses(profile,true);if(dialog.open)dialog.close();showToast('Live status saved.');}
      } catch(error) {
        console.error('Live status save failed:',error.code||error.message);
        profile.liveStatuses=previous;
        if(currentUser===profile&&dialog.open)errorMessage.textContent='Status could not be saved. Please try again.';
      } finally {profileChangePending=false;button.disabled=false;search.disabled=false;inputs.forEach(function(input){input.disabled=false;});updateProfileStatusSelectionCount();}
    }

    document.getElementById('profile-status-dialog').addEventListener('cancel',function(event){
      if(profileChangePending){event.preventDefault();document.getElementById('profile-status-error').textContent='Please wait for your status to finish saving.';}
    });
    const MAX_PRIVATE_INTEREST_ITEMS = 12;
    const MAX_INTEREST_IMAGE_BYTES = 12 * 1024 * 1024;
    const MAX_INTEREST_VIDEO_BYTES = 30 * 1024 * 1024;
    let interestObjectUrls = [];
    let profileChangePending = false;
    let galleryViewerState = null;
    let galleryViewerUrl = null;
    let galleryViewerRequest = 0;

    function openGalleryUpload() {
      if(!auth.currentUser||!currentUser||auth.currentUser.uid!==currentUser.uid)return;
      if(profileChangePending){showToast('Please wait for the current profile change to finish.');return;}
      const visibility=document.getElementById('interest-media-visibility');
      visibility.value=currentUser.communityVisible?'community':'private';
      visibility.disabled=!currentUser.communityVisible;
      document.getElementById('interest-visibility-notice').textContent=currentUser.communityVisible
        ? 'Posts not marked private are visible to signed-in members. Members may save shared content.'
        : 'Your profile is private, so all posts remain hidden. New posts are saved as private.';
      document.getElementById('profile-public-view').classList.add('hidden');
      document.getElementById('profile-gallery-upload-view').classList.remove('hidden');
      document.getElementById('interest-upload-title').focus();
    }

    function closeGalleryUpload() {
      if(profileChangePending){showToast('Please wait for the upload to finish.');return;}
      document.getElementById('profile-gallery-upload-view').classList.add('hidden');
      document.getElementById('profile-public-view').classList.remove('hidden');
      document.querySelector('.profile-gallery-upload-link').focus();
    }

    function isInterestMediaPath(path, uid) {
      if (typeof path !== 'string' || typeof uid !== 'string') return false;
      return ['interests', 'gallery'].some(function(folder) {
        const prefix = 'users/' + uid + '/' + folder + '/';
        return path.startsWith(prefix) && path.length > prefix.length && !path.slice(prefix.length).includes('/');
      });
    }

    function galleryPostId(item) {
      return typeof item.groupId==='string' && /^[a-zA-Z0-9_-]{1,120}$/.test(item.groupId) ? 'g_'+item.groupId : 's_'+item.path.slice(item.path.lastIndexOf('/')+1);
    }

    function isGalleryItemSelectedForSharing(item) {
      return !item.archived && item.visibility !== 'private';
    }

    function isGalleryItemShared(profile,item) {
      return profile.communityVisible === true && isGalleryItemSelectedForSharing(item);
    }

    function loadGalleryStorageSdk() {
      return import('https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js');
    }

    function fetchGalleryBlob(path) {
      return loadGalleryStorageSdk().then(function(sdk){return sdk.getBlob(storage.ref(path));});
    }

    function renderPrivateInterestGallery(profile,isOwner) {
      profile=profile||currentUser; isOwner=isOwner!==false;
      const grid=document.getElementById('profile-interest-grid'), archiveGrid=document.getElementById('profile-archive-grid'), archive=document.getElementById('profile-gallery-archive'), viewer=auth.currentUser;
      if(!grid||!archiveGrid||!archive)return;
      interestObjectUrls.forEach(function(url){URL.revokeObjectURL(url);}); interestObjectUrls=[]; grid.replaceChildren(); archiveGrid.replaceChildren();
      const validViewer=viewer&&(!isOwner||(currentUser&&currentUser.uid===viewer.uid));
      const items=validViewer&&profile&&Array.isArray(profile.interestMedia)?profile.interestMedia.slice(0,MAX_PRIVATE_INTEREST_ITEMS).filter(function(item){return item&&isInterestMediaPath(item.path,profile.uid);}):[];
      const visible=items.filter(function(item){return !item.archived&&(isOwner||isGalleryItemShared(profile,item));});
      const archived=isOwner?items.filter(function(item){return item.archived===true;}):[];
      const viewLabels=new Map();
      archive.classList.toggle('hidden',!isOwner||!archived.length);
      if(!archived.length) archive.open=false;
      document.getElementById('profile-archive-count').textContent='('+archived.length+')';
      if(!visible.length){const empty=document.createElement('p');empty.className='profile-gallery-empty';empty.textContent=isOwner?'Your gallery is ready when you are. Add a photo or video of something you love.':'This member has not shared any gallery items.';grid.appendChild(empty);}
      function renderItem(group, target) {
        const item=group[0];
        let previewBlobPromise=null;
        function loadPreviewBlob(){
          if(!previewBlobPromise)previewBlobPromise=fetchGalleryBlob(item.path).catch(function(error){previewBlobPromise=null;throw error;});
          return previewBlobPromise;
        }
        function openRenderedGallery(){
          if(!auth.currentUser||auth.currentUser.uid!==viewer.uid){showToast('Please reopen the profile to view this gallery.');return;}
          openGalleryViewer(group,profile,isOwner,loadPreviewBlob);
        }
        const card=document.createElement('figure');card.className='profile-interest-card';
        const preview=document.createElement('button');preview.type='button';preview.className='profile-media-preview';preview.setAttribute('aria-label','Open '+String(item.name||'gallery item')+(group.length>1?' carousel':'')+' in larger view');preview.addEventListener('click',openRenderedGallery);card.appendChild(preview);
        loadPreviewBlob().then(function(blob){if(!card.isConnected||!auth.currentUser||auth.currentUser.uid!==viewer.uid)return;const url=URL.createObjectURL(blob);interestObjectUrls.push(url);let media;if(String(item.type||'').startsWith('video/')){media=document.createElement('video');media.muted=true;media.preload='metadata';}else{media=document.createElement('img');media.alt='';}media.src=url;media.className='profile-interest-media';preview.prepend(media);}).catch(function(error){console.warn('Gallery item could not be loaded:',error.code||error.message);if(card.isConnected){const message=document.createElement('span');message.textContent='Preview unavailable';preview.prepend(message);}});
        if(group.length>1){const count=document.createElement('span');count.className='profile-media-count';count.textContent='1 / '+group.length;preview.appendChild(count);}
        const caption=document.createElement('figcaption');caption.textContent=String(item.name||'A special interest').slice(0,100);card.appendChild(caption);
        if(isOwner){
          const shared=isGalleryItemShared(profile,item);
          const state=document.createElement('span');state.className='profile-media-state';state.textContent=item.archived?'Archived':shared?'Shared':'Private';caption.appendChild(state);
          const views=document.createElement('span');views.className='profile-media-views';views.textContent='Loading views…';caption.appendChild(views);
          const postId=galleryPostId(item);
          if(!viewLabels.has(postId))viewLabels.set(postId,[]);
          viewLabels.get(postId).push(views);
        }
        target.appendChild(card);
      }
      const groups=[];
      visible.forEach(function(item){
        const existing=typeof item.groupId==='string'&&item.groupId?groups.find(function(group){return group[0].groupId===item.groupId;}):null;
        if(existing)existing.push(item);else groups.push([item]);
      });
      groups.forEach(function(group){renderItem(group,grid);});
      archived.forEach(function(item){renderItem([item],archiveGrid);});
      if(isOwner&&viewLabels.size) {
        functions.httpsCallable('getGalleryViewCounts')({postIds:Array.from(viewLabels.keys())}).then(function(result){
          if(!auth.currentUser||auth.currentUser.uid!==viewer.uid)return;
          viewLabels.forEach(function(labels,postId){
            const count=result.data && result.data[postId];
            if(!Number.isSafeInteger(count)||count<0)throw new Error('Invalid gallery view count.');
            labels.forEach(function(label){if(label.isConnected)label.textContent=count+' '+(count===1?'view':'views');});
          });
        }).catch(function(error){
          console.error('Gallery view counts could not be loaded:',error.code||error.message);
          viewLabels.forEach(function(labels){labels.forEach(function(label){if(label.isConnected)label.textContent='Views unavailable';});});
        });
      }
    }

    function openGalleryViewer(items,profile,isOwner,loadPreviewBlob) {
      if(!auth.currentUser||!items.length||(isOwner&&(!currentUser||currentUser.uid!==auth.currentUser.uid)))return;
      const dialog=document.getElementById('profile-gallery-viewer');
      galleryViewerState={items:items.slice(),profile:profile,isOwner:isOwner,menuOpen:false,edit:false,index:0,loadPreviewBlob:loadPreviewBlob};
      const state=galleryViewerState;
      document.getElementById('gallery-viewer-view-status').textContent='';
      renderGalleryViewer();
      openGalleryEngagement(state);
      if(!dialog.open)dialog.showModal();
      dialog.querySelector('.gallery-viewer-close').focus();
      if(!isOwner&&items.some(function(item){return isGalleryItemShared(profile,item);})) {
        functions.httpsCallable('recordGalleryView')({ownerId:profile.uid,postId:galleryPostId(items[0])}).catch(function(error){
          console.error('Gallery view could not be recorded:',error.code||error.message);
          if(galleryViewerState===state)document.getElementById('gallery-viewer-view-status').textContent='This view could not be counted.';
        });
      }
    }

    function toggleGalleryViewerOptions() {
      if(!galleryViewerState||!galleryViewerState.isOwner)return;
      galleryViewerState.menuOpen=!galleryViewerState.menuOpen;
      renderGalleryViewerOptions();
    }

    function renderGalleryViewer() {
      if(!galleryViewerState)return;
      const state=galleryViewerState,item=state.items[state.index],request=++galleryViewerRequest;
      const media=document.getElementById('gallery-viewer-media');
      if(galleryViewerUrl){URL.revokeObjectURL(galleryViewerUrl);galleryViewerUrl=null;}
      media.replaceChildren();
      media.setAttribute('aria-busy','true');
      const loading=document.createElement('p');loading.textContent='Loading media…';media.appendChild(loading);
      document.getElementById('gallery-viewer-caption').textContent=String(item.name||'A special interest').slice(0,100);
      document.getElementById('gallery-viewer-description').textContent=String(item.description||'').slice(0,500);
      document.getElementById('gallery-viewer-position').textContent=(state.index+1)+' / '+state.items.length;
      document.getElementById('gallery-viewer-navigation').hidden=state.items.length<2;
      const previous=document.getElementById('gallery-viewer-previous'),next=document.getElementById('gallery-viewer-next');
      const focused=document.activeElement;
      previous.disabled=state.index===0;
      next.disabled=state.index===state.items.length-1;
      if(focused===previous&&previous.disabled)next.focus();
      if(focused===next&&next.disabled)previous.focus();
      const blobPromise=state.index===0&&state.loadPreviewBlob?state.loadPreviewBlob():fetchGalleryBlob(item.path);
      blobPromise.then(function(blob){
        if(request!==galleryViewerRequest||galleryViewerState!==state)return;
        galleryViewerUrl=URL.createObjectURL(blob);
        const element=document.createElement(String(item.type||'').startsWith('video/')?'video':'img');
        if(element.tagName==='VIDEO'){element.controls=true;element.preload='metadata';}else element.alt=String(item.name||'Special interest photo').slice(0,100);
        element.src=galleryViewerUrl;media.replaceChildren(element);media.removeAttribute('aria-busy');
      }).catch(function(error){
        console.warn('Gallery viewer item could not be loaded:',error.code||error.message);
        if(request===galleryViewerRequest&&galleryViewerState===state){loading.textContent='This item could not be loaded right now.';media.removeAttribute('aria-busy');}
      });
      renderGalleryViewerOptions();
    }

    function renderGalleryViewerOptions() {
      if(!galleryViewerState)return;
      const state=galleryViewerState,item=state.items[state.index];
      const edit=document.getElementById('gallery-viewer-edit'),options=document.getElementById('gallery-viewer-options'),menu=document.getElementById('gallery-viewer-menu');
      options.hidden=!state.isOwner;
      options.setAttribute('aria-expanded',String(state.isOwner&&state.menuOpen));
      menu.hidden=!state.isOwner||!state.menuOpen;
      menu.replaceChildren();
      if(state.isOwner&&state.menuOpen){
        function addMenuAction(label,action){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',action);menu.appendChild(button);}
        addMenuAction('Edit',function(){state.menuOpen=false;state.edit=true;renderGalleryViewerOptions();edit.querySelector('input').focus();});
        if(item.archived)addMenuAction('Restore to gallery',function(){closeGalleryViewer();setInterestMediaArchived(item.path,false);});
        else addMenuAction('Archive',function(){closeGalleryViewer();setInterestMediaArchived(item.path,true);});
        addMenuAction('Delete',async function(){
          state.menuOpen=false;renderGalleryViewerOptions();
          const user=auth.currentUser;
          if(await confirmSiteAction('Delete gallery item?','This item will be permanently deleted.','Delete')&&galleryViewerState===state&&auth.currentUser&&user&&auth.currentUser.uid===user.uid){closeGalleryViewer();deletePrivateInterestMedia(item.path);}
        });
      }
      edit.replaceChildren();
      edit.classList.toggle('hidden',!state.isOwner||!state.edit);
      if(state.isOwner&&state.edit){
        const selected=isGalleryItemSelectedForSharing(item),shared=isGalleryItemShared(state.profile,item);
        const status=document.createElement('p');status.textContent=item.archived?'Archived':shared?'Shared with members':selected?'Private while your profile is private; shared when your profile is shared':'Private';edit.appendChild(status);
        if(state.items.length>1){const note=document.createElement('p');note.textContent='Title and description apply to the whole post. Sharing, archive and delete apply to the selected item.';edit.appendChild(note);}
        const form=document.createElement('form');form.className='gallery-edit-form';
        const titleLabel=document.createElement('label');titleLabel.textContent='Post title';
        const title=document.createElement('input');title.type='text';title.maxLength=80;title.value=String(item.name||'').slice(0,80);titleLabel.appendChild(title);
        const descriptionLabel=document.createElement('label');descriptionLabel.textContent='Description';
        const description=document.createElement('textarea');description.maxLength=500;description.rows=3;description.value=String(item.description||'').slice(0,500);descriptionLabel.appendChild(description);
        const save=document.createElement('button');save.type='submit';save.textContent='Save post';
        form.append(titleLabel,descriptionLabel,save);edit.appendChild(form);
        form.addEventListener('submit',async function(event){
          event.preventDefault();
          const user=auth.currentUser;
          if(!user||!currentUser||currentUser.uid!==user.uid||galleryViewerState!==state)return;
          if(profileChangePending){showToast('Please wait for the current profile change to finish.');return;}
          const ownerProfile=currentUser,previous=ownerProfile.interestMedia.slice(),postId=galleryPostId(item);
          const name=title.value.trim()||'A special interest',text=description.value.trim();
          profileChangePending=true;save.disabled=true;
          try {
            ownerProfile.interestMedia=previous.map(function(entry){return entry&&isInterestMediaPath(entry.path,user.uid)&&galleryPostId(entry)===postId?Object.assign({},entry,{name:name,description:text}):entry;});
            await persistUserProfile();
            if(auth.currentUser&&auth.currentUser.uid===user.uid&&currentUser===ownerProfile){
              if(galleryViewerState===state){
                state.items=state.items.map(function(entry){return ownerProfile.interestMedia.find(function(updated){return updated&&updated.path===entry.path;})||entry;});
                state.edit=false;
                document.getElementById('gallery-viewer-caption').textContent=name;
                document.getElementById('gallery-viewer-description').textContent=text;
                const image=document.querySelector('#gallery-viewer-media img');if(image)image.alt=name;
                renderGalleryViewerOptions();
                document.getElementById('gallery-viewer-options').focus();
              }
              if(!document.getElementById('owner-gallery-controls').classList.contains('hidden'))renderPrivateInterestGallery(ownerProfile,true);
              showToast('Post updated.');
            }
          } catch(error) {
            ownerProfile.interestMedia=previous;
            console.error('Post could not be updated:',error.code||error.message);
            if(auth.currentUser&&auth.currentUser.uid===user.uid)showToast('Post could not be updated. Please try again.');
          } finally {profileChangePending=false;save.disabled=false;}
        });
        function addAction(label,action){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',action);edit.appendChild(button);}
        if(!item.archived) {
          addAction(selected?'Make private':'Share when profile is shared',function(){closeGalleryViewer();setInterestMediaVisibility(item.path,selected?'private':'community');});
        }
        addAction('Cancel',function(){state.edit=false;renderGalleryViewerOptions();options.focus();});
      }
    }

    function moveGalleryViewer(direction) {
      if(!galleryViewerState)return;
      const next=galleryViewerState.index+direction;
      if(next<0||next>=galleryViewerState.items.length)return;
      galleryViewerState.menuOpen=false;
      galleryViewerState.edit=false;
      galleryViewerState.index=next;
      renderGalleryViewer();
    }

    function closeGalleryViewer() {
      const dialog=document.getElementById('profile-gallery-viewer');
      if(dialog&&dialog.open){dialog.close();resetGalleryViewer();}
    }

    function resetGalleryViewer(){
      galleryViewerRequest++;
      galleryViewerState=null;
      if(galleryViewerUrl){URL.revokeObjectURL(galleryViewerUrl);galleryViewerUrl=null;}
      document.getElementById('gallery-viewer-media').replaceChildren();
      document.getElementById('gallery-viewer-media').removeAttribute('aria-busy');
      document.getElementById('gallery-engagement').hidden=true;
      document.getElementById('gallery-comment-form').reset();
    }

    function openGalleryEngagement(state) {
      const section=document.getElementById('gallery-engagement');
      const shared=state.items.some(function(item){return isGalleryItemShared(state.profile,item);});
      section.hidden=!shared;
      if(!shared)return;
      const user=auth.currentUser, postId=galleryPostId(state.items[0]);
      const post=db.collection('galleryEngagement').doc(state.profile.uid).collection('posts').doc(postId);
      const likes=post.collection('likes'), comments=post.collection('comments');
      const likeButton=document.getElementById('gallery-like-button'), count=document.getElementById('gallery-like-count');
      const list=document.getElementById('gallery-comments-list'), status=document.getElementById('gallery-comments-status');
      const more=document.getElementById('gallery-comments-more'), form=document.getElementById('gallery-comment-form');
      const input=document.getElementById('gallery-comment-input'), commentButton=form.querySelector('[type="submit"]');
      const replyContext=document.getElementById('gallery-reply-context'), replyLabel=document.getElementById('gallery-reply-label');
      let liked=false, cursor=null, loading=false, submitting=false, replyTo=null, expandedThreads=new Set();
      function active(){return galleryViewerState===state&&auth.currentUser&&auth.currentUser.uid===user.uid;}
      function showError(message,error){console.error(message,error.code||error.message);if(active())status.textContent=message;}
      function clearReply(){replyTo=null;replyContext.hidden=true;replyLabel.textContent='';input.placeholder='Add a comment…';}
      likeButton.disabled=true;likeButton.setAttribute('aria-pressed','false');likeButton.textContent='♡ Like';
      count.textContent='';list.replaceChildren();status.textContent='Loading comments…';more.hidden=true;form.reset();clearReply();
      document.getElementById('gallery-reply-cancel').onclick=function(){clearReply();input.focus();};
      async function refreshLikes(){
        const results=await Promise.all([likes.get(),likes.doc(user.uid).get()]);
        if(!active())return;
        liked=results[1].exists;
        const total=results[0].size;
        likeButton.setAttribute('aria-pressed',String(liked));likeButton.textContent=liked?'♥ Liked':'♡ Like';
        count.textContent=total+' '+(total===1?'like':'likes');
        likeButton.disabled=false;
      }
      function buildCommentArticle(doc, data, likesMap){
        const article=document.createElement('article');article.className='gallery-comment';article.dataset.commentId=doc.id;article.tabIndex=-1;
        const header=document.createElement('div');header.className='gallery-comment-header';
        const name=document.createElement('strong');name.textContent=data.authorName;
        header.appendChild(name);
        const menu=document.createElement('details');menu.className='gallery-comment-menu';
        const trigger=document.createElement('summary');trigger.textContent='⋯';trigger.setAttribute('aria-label','Comment options for '+data.authorName);
        menu.appendChild(trigger);
        const actions=document.createElement('div');actions.className='gallery-comment-actions';
        function action(label,handler){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',function(){menu.open=false;handler();});actions.appendChild(button);}
        if(data.uid===user.uid||state.profile.uid===user.uid){
          action('Delete',async function(){
            if(!await confirmSiteAction('Delete comment?','This comment will be permanently deleted.','Delete')||!active())return;
            try {await doc.ref.delete();if(active())await loadComments(false);}
            catch(error){showError('Comment could not be deleted.',error);}
          });
        }
        if(data.uid===user.uid){
          action('Edit',function(){
            const edit=document.createElement('form');edit.className='gallery-comment-edit';
            const field=document.createElement('input');field.type='text';field.maxLength=500;field.required=true;field.value=data.text;field.setAttribute('aria-label','Edit comment');
            const save=document.createElement('button');save.type='submit';save.textContent='Save';
            const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';
            cancel.addEventListener('click',function(){edit.replaceWith(text);});
            edit.addEventListener('submit',async function(event){
              event.preventDefault();const value=field.value.trim();
              if(!value){status.textContent='Write a comment first.';return;}
              save.disabled=true;cancel.disabled=true;
              try {await doc.ref.update({text:value});if(active())await loadComments(false);}
              catch(error){showError('Comment could not be edited.',error);save.disabled=false;cancel.disabled=false;}
            });
            edit.append(field,save,cancel);text.replaceWith(edit);field.focus();
          });
        }
        action('Copy',async function(){
          try {
            if(!navigator.clipboard||!navigator.clipboard.writeText)throw new Error('Clipboard access is unavailable.');
            await navigator.clipboard.writeText(data.text);
            if(active())status.textContent='Comment copied.';
          } catch(error){showError('Comment could not be copied.',error);}
        });
        menu.appendChild(actions);header.appendChild(menu);article.appendChild(header);
        if(typeof data.replyTo==='string'&&typeof data.replyToName==='string'){
          const context=document.createElement('button');context.type='button';context.className='gallery-comment-reply-to';context.textContent='↳ Reply to '+data.replyToName;
          context.addEventListener('click',function(){
            const original=Array.from(list.querySelectorAll('.gallery-comment')).find(function(element){return element.dataset.commentId===data.replyTo;});
            if(original){original.scrollIntoView({block:'nearest'});original.focus();}
            else status.textContent='The original comment is not loaded or has been deleted.';
          });
          article.appendChild(context);
        }
        const text=document.createElement('p');text.textContent=data.text;
        article.appendChild(text);
        const row=document.createElement('div');row.className='gallery-comment-like-row';
        const likeInfo=likesMap.get(doc.id)||{count:0,liked:false};
        const likeBtn=document.createElement('button');likeBtn.type='button';likeBtn.className='gallery-comment-like';likeBtn.setAttribute('aria-pressed',String(likeInfo.liked));likeBtn.textContent=likeInfo.liked?'♥':'♡';likeBtn.setAttribute('aria-label',likeInfo.liked?'Unlike comment':'Like comment');
        const likeCount=document.createElement('span');likeCount.className='gallery-comment-like-count';likeCount.textContent=likeInfo.count+' '+(likeInfo.count===1?'like':'likes');
        likeBtn.addEventListener('click',async function(){
          likeBtn.disabled=true;
          try{
            const likesRef=doc.ref.collection('likes');
            if(likeInfo.liked){await likesRef.doc(user.uid).delete();likeInfo.count=Math.max(0,likeInfo.count-1);likeInfo.liked=false;}
            else{await likesRef.doc(user.uid).set({uid:user.uid});likeInfo.count++;likeInfo.liked=true;}
            likeBtn.setAttribute('aria-pressed',String(likeInfo.liked));likeBtn.textContent=likeInfo.liked?'♥':'♡';likeBtn.setAttribute('aria-label',likeInfo.liked?'Unlike comment':'Like comment');
            likeCount.textContent=likeInfo.count+' '+(likeInfo.count===1?'like':'likes');
          }catch(error){showError('Comment like could not be updated.',error);}
          finally{if(active())likeBtn.disabled=false;}
        });
        const reply=document.createElement('button');reply.type='button';reply.className='gallery-comment-reply';reply.textContent='Reply';reply.setAttribute('aria-label','Reply to '+data.authorName);
        reply.addEventListener('click',function(){replyTo={id:doc.id,name:data.authorName};replyLabel.textContent='Replying to '+data.authorName;replyContext.hidden=false;input.placeholder='Write a reply…';input.focus();});
        row.append(likeBtn,likeCount,reply);
        article.appendChild(row);
        return article;
      }
      async function loadComments(append){
        if(loading)return;
        loading=true;more.disabled=true;commentButton.disabled=true;
        try {
          const snapshot=await comments.orderBy('createdAt','desc').limit(300).get();
          if(!active())return;
          const docs=snapshot.docs;
          const byId=new Map();
          docs.forEach(function(doc){byId.set(doc.id,{doc:doc,data:doc.data()});});
          function rootOf(entry){let cur=entry;let guard=0;while(cur&&typeof cur.data.replyTo==='string'&&byId.has(cur.data.replyTo)&&guard++<20){cur=byId.get(cur.data.replyTo);}return cur;}
          const topLevel=[];const repliesOf=new Map();
          docs.forEach(function(doc){const entry=byId.get(doc.id);if(typeof entry.data.replyTo==='string'){const root=rootOf(entry);if(root&&root.doc.id!==entry.doc.id){if(!repliesOf.has(root.doc.id))repliesOf.set(root.doc.id,[]);repliesOf.get(root.doc.id).push(entry);return;}}topLevel.push(entry);});
          const likesMap=new Map();
          await Promise.all(docs.map(function(doc){return doc.ref.collection('likes').get().then(function(snap){likesMap.set(doc.id,{count:snap.size,liked:snap.docs.some(function(d){return d.id===user.uid;})});}).catch(function(){likesMap.set(doc.id,{count:0,liked:false});});}));
          list.replaceChildren();
          topLevel.forEach(function(entry){
            const article=buildCommentArticle(entry.doc,entry.data,likesMap);
            list.appendChild(article);
            const replies=(repliesOf.get(entry.doc.id)||[]).slice().sort(function(a,b){const ta=a.data.createdAt&&a.data.createdAt.toMillis?a.data.createdAt.toMillis():0;const tb=b.data.createdAt&&b.data.createdAt.toMillis?b.data.createdAt.toMillis():0;return ta-tb;});
            if(!replies.length)return;
            const thread=document.createElement('div');thread.className='gallery-comment-thread';
            const isOpen=expandedThreads.has(entry.doc.id);
            thread.hidden=!isOpen;
            replies.forEach(function(r){thread.appendChild(buildCommentArticle(r.doc,r.data,likesMap));});
            const toggle=document.createElement('button');toggle.type='button';toggle.className='gallery-comment-replies-toggle';
            function label(){return (thread.hidden?'Show ':'Hide ')+replies.length+' '+(replies.length===1?'reply':'replies');}
            toggle.textContent=label();
            toggle.addEventListener('click',function(){thread.hidden=!thread.hidden;if(thread.hidden)expandedThreads.delete(entry.doc.id);else expandedThreads.add(entry.doc.id);toggle.textContent=label();});
            list.appendChild(toggle);
            list.appendChild(thread);
          });
          more.hidden=true;
          status.textContent=list.children.length?'':'No comments yet.';
        } catch(error){showError('Comments could not be loaded.',error);}
        finally{loading=false;if(active()){more.disabled=false;commentButton.disabled=submitting;}}
      }
      likeButton.onclick=async function(){
        likeButton.disabled=true;
        try {if(liked)await likes.doc(user.uid).delete();else await likes.doc(user.uid).set({uid:user.uid});await refreshLikes();}
        catch(error){showError('Like could not be updated.',error);if(active())likeButton.disabled=false;}
      };
      more.onclick=function(){loadComments(true);};
      form.onsubmit=async function(event){
        event.preventDefault();
        const text=input.value.trim(),target=replyTo;
        if(submitting||loading)return;
        if(!text){status.textContent='Write a comment first.';return;}
        if(!currentUser||currentUser.uid!==user.uid){status.textContent='Sign in to comment.';return;}
        submitting=true;commentButton.disabled=true;
        try {
          const profileSnapshot=await db.collection('users').doc(user.uid).get();
          if(!active())return;
          if(!profileSnapshot.exists||typeof profileSnapshot.data().username!=='string')throw new Error('Your saved profile name is unavailable.');
          const authorName=profileSnapshot.data().displayName||profileSnapshot.data().username;
          const comment={uid:user.uid,authorName:authorName,text:text,createdAt:firebase.firestore.FieldValue.serverTimestamp()};
          if(target){comment.replyTo=target.id;comment.replyToName=target.name;}
          await comments.add(comment);
          if(active()){input.value='';clearReply();if(target)expandedThreads.add(target.id);await loadComments(false);}
        } catch(error){showError(target?'Reply could not be posted. The comment may have been removed.':'Comment could not be posted.',error);}
        finally{submitting=false;if(active())commentButton.disabled=loading;}
      };
      refreshLikes().catch(function(error){
        console.error('Likes could not be loaded:',error.code||error.message);
        if(active())count.textContent='Likes unavailable';
      });
      loadComments(false);
    }

    document.getElementById('profile-gallery-viewer').addEventListener('close',function(){
      if(!this.open)resetGalleryViewer();
    });
    document.getElementById('profile-gallery-viewer').addEventListener('keydown',function(event){
      if(event.key==='Escape'){
        const menu=event.target.closest('.gallery-comment-menu[open]');
        if(menu){event.preventDefault();event.stopPropagation();menu.open=false;menu.querySelector('summary').focus();return;}
        if(galleryViewerState&&galleryViewerState.menuOpen){
          event.preventDefault();event.stopPropagation();galleryViewerState.menuOpen=false;renderGalleryViewerOptions();document.getElementById('gallery-viewer-options').focus();return;
        }
        event.preventDefault();event.stopPropagation();closeGalleryViewer();
      }
      else if((event.key==='ArrowLeft'||event.key==='ArrowRight')&&!['VIDEO','TEXTAREA','INPUT'].includes(event.target.tagName)){
        event.preventDefault();event.stopPropagation();moveGalleryViewer(event.key==='ArrowLeft'?-1:1);
      }
    });
    let galleryTouchStart=null;
    const galleryViewerMedia=document.getElementById('gallery-viewer-media');
    galleryViewerMedia.addEventListener('touchstart',function(event){
      if(event.touches.length!==1||event.target.tagName==='VIDEO'){galleryTouchStart=null;return;}
      galleryTouchStart={x:event.touches[0].clientX,y:event.touches[0].clientY};
    },{passive:true});
    galleryViewerMedia.addEventListener('touchend',function(event){
      if(!galleryTouchStart||event.changedTouches.length!==1)return;
      const dx=event.changedTouches[0].clientX-galleryTouchStart.x,dy=event.changedTouches[0].clientY-galleryTouchStart.y;
      galleryTouchStart=null;
      if(Math.abs(dx)>50&&Math.abs(dx)>Math.abs(dy)*1.5)moveGalleryViewer(dx<0?1:-1);
    },{passive:true});
    galleryViewerMedia.addEventListener('touchcancel',function(){galleryTouchStart=null;},{passive:true});

    document.addEventListener('click',function(event){
      if(galleryViewerState&&galleryViewerState.menuOpen&&!event.target.closest('.gallery-viewer-options-wrap')){
        galleryViewerState.menuOpen=false;renderGalleryViewerOptions();
      }
      document.querySelectorAll('.gallery-comment-menu[open]').forEach(function(menu){if(!menu.contains(event.target))menu.open=false;});
    });

    async function setInterestMediaVisibility(path,visibility){
      const user=auth.currentUser;if(!user||!currentUser||currentUser.uid!==user.uid||!['private','community'].includes(visibility))return;
      const item=Array.isArray(currentUser.interestMedia)&&currentUser.interestMedia.find(function(entry){return entry.path===path;});if(!item||item.archived||!isInterestMediaPath(path,user.uid))return;
      await updateInterestMedia(path,{visibility:visibility},visibility==='community'?(currentUser.communityVisible?'This item is shared with signed-in members.':'This item will be shared when your profile is shared.'):'This item is private to you.');
    }

    async function setInterestMediaArchived(path,archived){
      const user=auth.currentUser;if(!user||!currentUser||currentUser.uid!==user.uid||!isInterestMediaPath(path,user.uid))return;
      const item=Array.isArray(currentUser.interestMedia)&&currentUser.interestMedia.find(function(entry){return entry.path===path;});
      if(!item||Boolean(item.archived)===archived)return;
      await updateInterestMedia(path,{visibility:'private',archived:archived},archived?'Item archived and made private.':'Item restored as private.');
    }

    async function updateInterestMedia(path,changes,message) {
      if(profileChangePending){showToast('Please wait for the current profile change to finish.');return;}
      profileChangePending=true;
      showToast('Saving gallery visibility…');
      try {
        await storage.ref(path).updateMetadata({customMetadata:{visibility:changes.visibility}});
        currentUser.interestMedia=currentUser.interestMedia.map(function(entry){return entry.path===path?Object.assign({},entry,changes):entry;});
        await persistUserProfile();
        renderProfile(currentUser,true);
        showToast(message);
      } catch(error) {
        console.error('Gallery change failed:',error.code||error.message);
        try {
          await storage.ref(path).updateMetadata({customMetadata:{visibility:'private'}});
          currentUser.interestMedia=currentUser.interestMedia.map(function(entry){return entry.path===path?Object.assign({},entry,{visibility:'private'}):entry;});
          await persistUserProfile();
        } catch(cleanupError) { console.error('Gallery privacy recovery failed:',cleanupError.code||cleanupError.message); }
        renderProfile(currentUser,true);
        showToast('That gallery change could not be saved. Please check its visibility and try again.');
      } finally { profileChangePending=false; }
    }

    async function uploadInterestMedia() {
      const input = document.getElementById('interest-media-files');
      const status = document.getElementById('interest-upload-status');
      const user = auth.currentUser;
      if (!user || !currentUser || currentUser.uid !== user.uid) { showToast('Sign in to add to your gallery.'); return; }
      if (profileChangePending) { showToast('Please wait for the current profile change to finish.'); return; }
      const files = input && input.files ? Array.from(input.files) : [];
      const captionInput=document.getElementById('interest-media-caption');
      const chosenCaption=captionInput?captionInput.value.trim().slice(0,80):'';
      const descriptionInput=document.getElementById('interest-media-description');
      const description=descriptionInput?descriptionInput.value.trim().slice(0,500):'';
      const visibilityInput=document.getElementById('interest-media-visibility');
      const chosenVisibility=visibilityInput&&visibilityInput.value;
      if(!['private','community'].includes(chosenVisibility)){showToast('Choose who can see this post.');return;}
      if (!files.length) { showToast('Choose at least one photo or video first.'); return; }
      const existing = Array.isArray(currentUser.interestMedia) ? currentUser.interestMedia.slice() : [];
      const previousItems = existing.slice();
      if (existing.length + files.length > MAX_PRIVATE_INTEREST_ITEMS) { showToast('Your gallery can hold up to 12 items.'); return; }
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];
      for (const file of files) {
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        const maxBytes = isVideo ? MAX_INTEREST_VIDEO_BYTES : MAX_INTEREST_IMAGE_BYTES;
        if ((!isImage && !isVideo) || !allowed.includes(file.type) || file.size > maxBytes || file.size === 0) {
          showToast('One file has an unsupported type or is over its size limit.'); return;
        }
      }
      const button = document.querySelector('.profile-upload-panel .calm-primary-button');
      profileChangePending = true;
      if (button) button.disabled = true;
      if (status) status.textContent = 'Uploading your files…';
      const uploadedRefs = [];
      const groupId = files.length > 1 ? Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12) : null;
      try {
        const storageSdk = await loadGalleryStorageSdk();
        for (const file of files) {
          const extensionByType={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'};
          const suffix=extensionByType[file.type];
          const path='users/'+user.uid+'/gallery/'+Date.now()+'-'+Math.random().toString(36).slice(2,12)+'.'+suffix;
          const displayName=chosenCaption||(file.type.startsWith('video/')?'Video':'Photo');
          const ref = storage.ref(path);
          const defaultVisibility=chosenVisibility;
          await storageSdk.uploadBytes(ref,file,{contentType:file.type,customMetadata:{visibility:defaultVisibility}});
          uploadedRefs.push(ref);
          const item={path:path,type:file.type,name:displayName,description:description,visibility:defaultVisibility};
          if(groupId)item.groupId=groupId;
          existing.push(item);
          currentUser.interestMedia=existing.slice(0,MAX_PRIVATE_INTEREST_ITEMS);
            await persistUserProfile();
        }
        input.value = '';
        if(captionInput) captionInput.value='';
        if(descriptionInput) descriptionInput.value='';
        renderPrivateInterestGallery();
        if (status) status.textContent = chosenVisibility==='community'?(currentUser.communityVisible?'Your post was saved and shared with signed-in members.':'Your post was saved privately and will be shared when your profile is shared.'):'Your post was saved privately.';
        renderProfile(currentUser,true);
        showToast('Your profile gallery has been updated.');
      } catch (error) {
        currentUser.interestMedia = previousItems;
        let cleanupFailed = false;
        await Promise.all(uploadedRefs.map(function(ref) {
          return ref.delete().catch(function(cleanupError) {
            cleanupFailed = true;
            console.error('Gallery file cleanup failed:',cleanupError.code||cleanupError.message);
          });
        }));
        await persistUserProfile().catch(function(profileError){cleanupFailed=true;console.error('Gallery metadata cleanup failed:',profileError.code||profileError.message);});
        console.error('Private gallery upload failed:', error.code || error.message);
        if (status) status.textContent = cleanupFailed?'Upload failed and cleanup could not be completed. Check your gallery before trying again.':'Upload failed. Your profile was not updated.';
        showToast(cleanupFailed?'Upload failed and cleanup was incomplete. Check your gallery.':'The gallery upload could not be completed. Check Storage setup and try again.');
      } finally {
        profileChangePending = false;
        if (button) button.disabled = false;
      }
    }

    async function deleteGalleryEngagement(ownerId,postId) {
      const post=db.collection('galleryEngagement').doc(ownerId).collection('posts').doc(postId);
      for(const name of ['likes','comments']) {
        const collection=post.collection(name);
        let snapshot;
        do {
          snapshot=await collection.limit(400).get();
          if(!snapshot.empty){
            const batch=db.batch();
            snapshot.docs.forEach(function(doc){batch.delete(doc.ref);});
            await batch.commit();
          }
          await functions.httpsCallable('deleteGalleryViews')({postId:postId});
        } while(!snapshot.empty);
      }
    }

    async function deletePrivateInterestMedia(path) {
      const user=auth.currentUser;if(!user||!currentUser||currentUser.uid!==user.uid||!isInterestMediaPath(path,user.uid))return;
      const previous=Array.isArray(currentUser.interestMedia)?currentUser.interestMedia.slice():[],item=previous.find(function(entry){return entry.path===path;});if(!item)return;
      if(profileChangePending){showToast('Please wait for the current profile change to finish.');return;}
      profileChangePending=true;
      try {
        await storage.ref(path).updateMetadata({customMetadata:{visibility:'private'}});
        currentUser.interestMedia=previous.filter(function(entry){return entry.path!==path;});
        await persistUserProfile();
        if(!currentUser.interestMedia.some(function(entry){return galleryPostId(entry)===galleryPostId(item);}))await deleteGalleryEngagement(user.uid,galleryPostId(item));
        renderPrivateInterestGallery();
        await storage.ref(path).delete();
        showToast('Gallery item deleted.');
      } catch(error) {
        currentUser.interestMedia=previous;
        console.error('Gallery deletion failed:',error.code||error.message);
        await storage.ref(path).updateMetadata({customMetadata:{visibility:'private'}}).catch(function(recoveryError){console.error('Gallery privacy recovery failed:',recoveryError.code||recoveryError.message);});
        currentUser.interestMedia=previous.map(function(entry){return entry.path===path?Object.assign({},entry,{visibility:'private'}):entry;});
        await persistUserProfile().catch(function(recoveryError){console.error('Gallery profile recovery failed:',recoveryError.code||recoveryError.message);});
        renderPrivateInterestGallery();showToast('That gallery item could not be removed. Please check its visibility and try again.');
      } finally {profileChangePending=false;}
    }

    let directoryProfiles=null; let directoryLoadPromise=null; let directoryLoadUserId=null;
    let directoryRenderVersion=0; let directoryLoadError=null;
    let directoryPage=1; let directoryLastQuery=''; const DIRECTORY_PAGE_SIZE=24;
    async function renderCommunityDirectory(searchQuery=''){
      const grid=document.getElementById('members-grid');if(!grid)return;
      const renderVersion=++directoryRenderVersion;
      if(!auth.currentUser){directoryProfiles=null;directoryLoadError=null;grid.replaceChildren();const msg=document.createElement('p');msg.className='profile-gallery-empty';msg.textContent='Sign in to explore profiles shared by Sanctuary members.';grid.appendChild(msg);return;}
      const viewerId=auth.currentUser.uid;
      if(directoryLoadError&&grid.querySelector('[role="alert"]'))return;
      try{if(!directoryProfiles){
        if(directoryLoadError)throw directoryLoadError;
        if(directoryLoadPromise&&directoryLoadUserId!==viewerId){await directoryLoadPromise.catch(function(error){console.error('Previous directory request failed:',error.code||error.message);});if(auth.currentUser&&auth.currentUser.uid===viewerId&&renderVersion===directoryRenderVersion)await renderCommunityDirectory(searchQuery);return;}
        if(!directoryLoadPromise){grid.replaceChildren();const status=document.createElement('p');status.className='directory-status';status.setAttribute('role','status');status.textContent='Loading members…';grid.appendChild(status);directoryLoadUserId=viewerId;directoryLoadPromise=functions.httpsCallable('listCommunityProfiles')().then(function(result){if(!Array.isArray(result.data))throw new Error('Invalid community directory response.');if(auth.currentUser&&auth.currentUser.uid===viewerId)directoryProfiles=result.data;}).finally(function(){directoryLoadPromise=null;directoryLoadUserId=null;});}await directoryLoadPromise;}
        if(!auth.currentUser||auth.currentUser.uid!==viewerId||renderVersion!==directoryRenderVersion)return;
        const rawQuery=String(searchQuery||'').trim();
        if(rawQuery!==directoryLastQuery){directoryPage=1;directoryLastQuery=rawQuery;}
        const query=rawQuery.toLowerCase(),results=(directoryProfiles||[]).filter(function(profile){return !query||String(profile.username||'').toLowerCase().includes(query)||String(profile.displayName||'').toLowerCase().includes(query);});grid.replaceChildren();
        if(!results.length){const empty=document.createElement('p');empty.className='profile-gallery-empty';empty.textContent=query?'No shared profiles match that search.':'No profiles have been shared yet. You can choose whether yours is visible on your profile page.';grid.appendChild(empty);return;}
        const visible=results.slice(0,directoryPage*DIRECTORY_PAGE_SIZE);
        visible.forEach(function(profile){const card=document.createElement('article');card.className='community-profile-card';const avatarUrl=safeProfileAvatarUrl(profile.avatar);if(avatarUrl){const avatar=document.createElement('img');avatar.src=avatarUrl;avatar.alt='';avatar.className='community-profile-avatar';card.appendChild(avatar);}const body=document.createElement('div');body.className='community-profile-card-body';const name=document.createElement('h3');name.textContent=String(profile.displayName||profile.username||'Sanctuary member').slice(0,40);body.appendChild(name);const bio=document.createElement('p');bio.textContent=profile.profileVisible?String(profile.bio||'A member of the Sanctuary community.').slice(0,150):'A member sharing special-interest media.';body.appendChild(bio);const types=document.createElement('p');types.className='community-profile-types';types.textContent=profile.profileVisible?(Array.isArray(profile.neurotypes)?profile.neurotypes:[]).slice(0,5).join(' · '):'';body.appendChild(types);const button=document.createElement('button');button.type='button';button.className='calm-secondary-button';button.textContent='Open profile';button.addEventListener('click',function(){openCommunityProfile(profile.uid,true);});body.appendChild(button);card.appendChild(body);grid.appendChild(card);});
        if(visible.length<results.length){const more=document.createElement('button');more.type='button';more.className='directory-load-more';more.textContent='Load more members ('+(results.length-visible.length)+' remaining)';more.addEventListener('click',function(){directoryPage++;renderCommunityDirectory(rawQuery);});grid.appendChild(more);}
      }catch(error){if(renderVersion!==directoryRenderVersion||!auth.currentUser||auth.currentUser.uid!==viewerId)return;directoryProfiles=null;directoryLoadError=error;grid.replaceChildren();const fail=document.createElement('p');fail.className='profile-gallery-empty';fail.setAttribute('role','alert');fail.textContent='The community directory is unavailable. Check your connection and try again. If this continues, the directory service may need to be deployed.';const retry=document.createElement('button');retry.type='button';retry.className='calm-secondary-button';retry.textContent='Try again';retry.addEventListener('click',function(){directoryLoadError=null;renderCommunityDirectory(document.getElementById('member-search-input').value);});grid.append(fail,retry);console.error('Community directory load failed:',error.code||error.message);}
    }
    async function openCommunityProfile(uid,updateHistory,pendingVersion){
      if(!auth.currentUser){openAuthModal('signup');return false;}if(typeof uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(uid)){showToast('That profile link is not valid.');return false;}
      const requestVersion = pendingVersion === undefined ? ++routeVersion : pendingVersion;
      const viewerId = auth.currentUser.uid;
      try{const snapshot=await db.collection('communityProfiles').doc(uid).get();if(requestVersion!==routeVersion)return false;if(!auth.currentUser||auth.currentUser.uid!==viewerId){if(pendingVersion!==undefined)handleInitialRoute();return false;}if(!snapshot.exists||snapshot.data().visible!==true||snapshot.data().profileVisible!==true){showToast('This profile is private or unavailable.');return false;}const shared=snapshot.data();const profile={uid:snapshot.id,username:shared.username,displayName:typeof shared.displayName==='string'?shared.displayName:null,avatar:shared.avatar,bio:shared.bio,neurotypes:shared.neurotypes,liveStatuses:shared.liveStatuses,links:shared.links,communityVisible:true,interestMedia:Array.isArray(shared.interestMedia)?shared.interestMedia:[]};
        hideRouteLoading();const embeds=['embed03','embed35','embed-store','embed13','embed09','embed41','embed07','embed06','embed11','embed04','embed15','embed16'];embeds.forEach(function(id){const el=document.getElementById(id);if(el)el.classList.remove('active-embed');});const directory=document.getElementById('directory-view');if(directory){directory.classList.add('hidden');directory.classList.remove('active-embed');directory.style.display='none';}const cvOcp=document.getElementById('confessions-view');if(cvOcp){cvOcp.classList.add('hidden');cvOcp.classList.remove('active-embed');cvOcp.style.display='none';}const page=document.getElementById('profile-page');if(page){page.classList.remove('hidden');page.style.display='block';page.classList.add('active-embed');}updateSkipTarget('profile-page');renderProfile(profile,false);if(updateHistory!==false)history.pushState(null,null,'#member/'+encodeURIComponent(uid));window.scrollTo({top:0,behavior:'instant'});return true;
      }catch(error){if(requestVersion!==routeVersion)return false;showToast('This profile is private or could not be loaded.');console.error('Community profile load failed:',error.code||error.message);return false;}
    }
    function returnToCommunityDirectory(){switchView('directory',true);}

    function positionHeaderSearch() {
     const input = document.getElementById('header-search-input');
     const iconBtn = document.getElementById('search-icon-btn');
     if (!input || !iconBtn || !isSearchOpen) return;
     const iconRect = iconBtn.getBoundingClientRect();
     const width = Math.max(180, Math.min(280, iconRect.right - 12, window.innerWidth - 24));
     const top = iconRect.bottom + 16;
     input.style.setProperty('position', 'fixed', 'important');
     input.style.setProperty('top', top + 'px', 'important');
     input.style.setProperty('left', 'auto', 'important');
     input.style.setProperty('right', (window.innerWidth - iconRect.right) + 'px', 'important');
     input.style.setProperty('width', width + 'px', 'important');
     input.style.setProperty('max-width', width + 'px', 'important');
     input.style.setProperty('padding-inline', '14px', 'important');
     input.style.setProperty('border-width', '1px', 'important');
     input.style.setProperty('display', 'block', 'important');
     input.style.setProperty('visibility', 'visible', 'important');
     input.style.setProperty('z-index', '1100', 'important');
     input.style.setProperty('transform-origin', 'center right', 'important');
     const measuredRight = input.getBoundingClientRect().right;
     const desiredRight = iconRect.right;
     if (Math.abs(measuredRight - desiredRight) > 1) {
       const currentRight = parseFloat(input.style.right) || 0;
       input.style.setProperty('right', (currentRight - (desiredRight - measuredRight)) + 'px', 'important');
     }
    }

    function toggleHeaderSearch(event) {
     event.stopPropagation();
      const input = document.getElementById('header-search-input');
      const iconBtn = document.getElementById('search-icon-btn');
      
      isSearchOpen = !isSearchOpen;

      if (isSearchOpen) {
        if (input) {
          input.style.setProperty('display', 'block', 'important');
          input.style.setProperty('visibility', 'visible', 'important');
        }
        var searchContainer = input && input.closest('.nav-search');
        if (searchContainer) searchContainer.classList.add('search-open');
        input.classList.remove('w-0', 'opacity-0', 'pointer-events-none');
        input.classList.add('w-56', 'opacity-100', 'pointer-events-auto');
        input.style.setProperty('transform', 'scaleX(0)', 'important');
        positionHeaderSearch();
        requestAnimationFrame(function() {
          positionHeaderSearch();
          input.style.setProperty('transform', 'scaleX(0)', 'important');
          input.style.setProperty('opacity', '1', 'important');
          requestAnimationFrame(function() {
            input.style.setProperty('transform', 'scaleX(1)', 'important');
            input.focus();
          });
        });
        iconBtn.setAttribute('aria-label', 'Close community search');
        iconBtn.setAttribute('aria-expanded', 'true');
        iconBtn.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
        searchAuthPrompt = false;
      } else {
        closeHeaderSearch();
      }
    }

    window.addEventListener('resize', function() {
      positionHeaderSearch();
    });

    function closeHeaderSearch(options) {
      options = options || {};
      const input = document.getElementById('header-search-input');
      const iconBtn = document.getElementById('search-icon-btn');
      const wasSearchAuthPrompt = searchAuthPrompt;
      searchAuthPrompt = false;
      
      isSearchOpen = false;
      if (input) {
        var searchContainer = input.closest('.nav-search');
        input.style.setProperty('transform', 'scaleX(0)', 'important');
        input.style.setProperty('opacity', '0', 'important');
        input.classList.remove('w-56', 'opacity-100', 'pointer-events-auto');
        input.classList.add('opacity-0', 'pointer-events-none');
        window.setTimeout(function() {
          if (!isSearchOpen) {
            if (searchContainer) searchContainer.classList.remove('search-open');
            input.classList.remove('w-56', 'w-0');
            input.classList.add('w-0');
            input.style.setProperty('width', '0px', 'important');
            input.style.setProperty('max-width', '0px', 'important');
            input.style.setProperty('padding-inline', '0px', 'important');
            input.style.setProperty('border-width', '0px', 'important');
            input.style.setProperty('visibility', 'hidden', 'important');
            input.style.setProperty('display', 'none', 'important');
            if (options.clear !== false) input.value = '';
          }
        }, 220);
      }
      if (iconBtn) {
        iconBtn.setAttribute('aria-label', 'Search community directory');
        iconBtn.setAttribute('aria-expanded', 'false');
        iconBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>';
      }
      if (wasSearchAuthPrompt) closeAuthModal();
      
      const directoryView = document.getElementById('directory-view');
      if (options.returnHome !== false && directoryView && !directoryView.classList.contains('hidden')) {
        directoryView.classList.add('hidden');
        directoryView.classList.remove('active-embed');
        switchPage('home', true);
      }
    }

    function handleHeaderSearchInput(event) {
      const query = event.target.value.trim();
      const directoryView = document.getElementById('directory-view');

      const mainSearchInput = document.getElementById('member-search-input');
      if (mainSearchInput) mainSearchInput.value = query;
      if (query.length > 0) {
        if (directoryView && directoryView.classList.contains('hidden')) switchView('directory', false);
        else renderCommunityDirectory(query);
      } else {
        if (directoryView) { directoryView.classList.add('hidden'); directoryView.classList.remove('active-embed'); }
        switchPage('home', true);
      }

    }

    function handleHeaderSearchKey(event) {
      if (event.key === 'Escape') {
        closeHeaderSearch();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const query = event.target.value.trim();
        if (query.length > 0) {
          const mainSearchInput = document.getElementById('member-search-input');
          if (mainSearchInput) mainSearchInput.value = query;
          switchView('directory');
          closeHeaderSearch({ clear: true, returnHome: false });
        }
      }
    }

    function filterCommunityMembers() {
      const input = document.getElementById('member-search-input');
      const query = input ? input.value.trim() : '';
      renderCommunityDirectory(query);
    }

    function openSettingsView() {
      if(profileChangePending){showToast('Please wait for the current profile change to finish.');return;}
      const uploadView=document.getElementById('profile-gallery-upload-view');
      if(uploadView)uploadView.classList.add('hidden');
      const usernameInput = document.getElementById('edit-username');
      const emailInput = document.getElementById('edit-email');
      
      if (usernameInput) usernameInput.value = currentUser.username || '';
      const displayNameInput = document.getElementById('edit-display-name');
      if (displayNameInput) displayNameInput.value = currentUser.displayName || '';
      if (emailInput) emailInput.value = currentUser.email || '';
      
      const bioInput = document.getElementById('edit-bio');
      if (bioInput) bioInput.value = currentUser.bio || '';
      const avatarFile = document.getElementById('edit-avatar-file');
      if (avatarFile) avatarFile.value = '';
      
      renderCheckboxList('edit-neurotypes-container', currentUser.neurotypes || []);

      const publicView = document.getElementById('profile-public-view');
      const settingsView = document.getElementById('profile-settings-view');

      if (publicView) publicView.classList.add('hidden');
      if (settingsView) settingsView.classList.remove('hidden');

      const links = currentUser.links || [];
      for (let i = 0; i < 6; i++) {
        document.getElementById(`edit-link-${i+1}-label`).value = links[i]?.label || '';
        document.getElementById(`edit-link-${i+1}-url`).value = links[i]?.url || '';
      }
    }

    function closeSettingsView() {
      const publicView = document.getElementById('profile-public-view');
      const settingsView = document.getElementById('profile-settings-view');

      if (settingsView) settingsView.classList.add('hidden');
      if (publicView) publicView.classList.remove('hidden');

      const links = currentUser.links || [];
      for (let i = 0; i < 6; i++) {
        document.getElementById(`edit-link-${i+1}-label`).value = links[i]?.label || '';
        document.getElementById(`edit-link-${i+1}-url`).value = links[i]?.url || '';
      }
    }

    function communityProfileProjection(profile) {
      const user=auth.currentUser; if(!user||!profile||profile.uid!==user.uid) throw new Error('Profile owner mismatch.');
      const profileVisible=profile.communityVisible===true;
      if(!profileVisible) return null;
      const items=Array.isArray(profile.interestMedia)?profile.interestMedia.filter(isGalleryItemSelectedForSharing).slice(0,12):[];
      const sharedPostIds={};
      const projection={uid:user.uid,visible:true,profileVisible:profileVisible,username:String(profile.username||'Sanctuary member').slice(0,40),displayName:typeof profile.displayName==='string'&&profile.displayName.trim()?String(profile.displayName).trim().slice(0,40):null,interestMedia:items.map(function(item){sharedPostIds[galleryPostId(item)]=true;const result={path:item.path,type:item.type,name:item.name,visibility:item.visibility};if(typeof item.groupId==='string'&&item.groupId)result.groupId=item.groupId;if(typeof item.description==='string')result.description=item.description.slice(0,500);return result;}),sharedPostIds:sharedPostIds,updatedAt:firebase.firestore.FieldValue.serverTimestamp()};
      if(profileVisible){projection.avatar=profile.avatar||null;projection.bio=String(profile.bio||'').slice(0,150);projection.neurotypes=Array.isArray(profile.neurotypes)?profile.neurotypes.filter(function(type){return availableNeurotypes.includes(type);}):[];projection.liveStatuses=validProfileStatuses(profile.liveStatuses);projection.links=Array.isArray(profile.links)?profile.links.slice(0,6):[];}
      return projection;
    }

    function syncCommunityProfile(profile) {
      const projection=communityProfileProjection(profile);
      const ref=db.collection('communityProfiles').doc(profile.uid);
      return projection?ref.set(projection):ref.delete();
    }

    function persistUserProfile(visibilityOverride) {
      const user = auth.currentUser;
      if (!user || !currentUser || currentUser.uid !== user.uid) {
        return Promise.reject(new Error('No matching signed-in account.'));
      }
      const profile = {
        uid: user.uid,
        username: String(currentUser.username || '').trim().slice(0, 40),
        displayName: typeof currentUser.displayName === 'string' && currentUser.displayName.trim() ? currentUser.displayName.trim().slice(0, 40) : null,
        avatar: currentUser.avatar || null,
        bio: String(currentUser.bio || '').slice(0, 150),
        neurotypes: Array.isArray(currentUser.neurotypes) ? currentUser.neurotypes.filter(function(type) { return availableNeurotypes.includes(type); }) : [],
        liveStatuses: validProfileStatuses(currentUser.liveStatuses),
        links: Array.isArray(currentUser.links) ? currentUser.links.slice(0, 6) : [],
        lastUsernameChange: Number(currentUser.lastUsernameChange) || null,
        interestMedia: Array.isArray(currentUser.interestMedia) ? currentUser.interestMedia.slice(0, 12) : [],
        communityVisible: typeof visibilityOverride === 'boolean' ? visibilityOverride : currentUser.communityVisible === true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      const projection=communityProfileProjection(profile);
      const batch=db.batch();
      batch.set(db.collection('users').doc(user.uid),profile,{merge:true});
      const communityRef=db.collection('communityProfiles').doc(user.uid);
      if(projection)batch.set(communityRef,projection);else batch.delete(communityRef);
      return batch.commit().then(function(){directoryProfiles=null;});
    }

    async function setProfileCommunityVisibility(visible) {
      const control=document.getElementById('profile-community-visible');
      const user=auth.currentUser;
      if(!user||!currentUser||currentUser.uid!==user.uid||profileChangePending){
        if(control)control.checked=Boolean(currentUser&&currentUser.communityVisible);
        showToast('Please wait for the current profile change to finish.');
        return;
      }
      profileChangePending=true;
      if(control){control.checked=Boolean(currentUser.communityVisible);control.disabled=true;control.setAttribute('aria-busy','true');}
      showToast('Saving profile visibility…');
      const previousVisibility=currentUser.communityVisible;
      try {
        await persistUserProfile(visible);
        if(!currentUser||!auth.currentUser||currentUser.uid!==user.uid||auth.currentUser.uid!==user.uid)return;
        currentUser.communityVisible=visible;
        renderProfile(currentUser,true);
        showToast(visible?'Your profile and selected gallery items are shared with signed-in members.':'Your profile and entire gallery are private.');
      } catch(error) {
        console.error('Profile visibility change failed:',error.code||error.message);
        if(currentUser&&auth.currentUser&&currentUser.uid===user.uid&&auth.currentUser.uid===user.uid){
          try {
            const saved=await db.collection('users').doc(user.uid).get({source:'server'});
            if(!saved.exists)throw new Error('Saved profile not found.');
            if(!currentUser||!auth.currentUser||currentUser.uid!==user.uid||auth.currentUser.uid!==user.uid)return;
            currentUser.communityVisible=saved.data().communityVisible===true;
            renderProfile(currentUser,true);
            showToast('Profile visibility could not be saved. Your saved setting has been restored.');
          } catch(recoveryError) {
            console.error('Profile visibility verification failed:',recoveryError.code||recoveryError.message);
            if(!currentUser||!auth.currentUser||currentUser.uid!==user.uid||auth.currentUser.uid!==user.uid)return;
            currentUser.communityVisible=previousVisibility;
            renderProfile(currentUser,true);
            showToast('Could not verify your profile privacy. Reconnect and refresh to check your saved setting.');
          }
        }
      } finally {
        profileChangePending=false;
        if(control){control.disabled=false;control.removeAttribute('aria-busy');}
      }
    }

    let profileConfirmationPending=false;
    async function handleProfileUpdate(event) {
      event.preventDefault();
      if (!currentUser || !auth.currentUser || profileConfirmationPending) return;
      const profile=currentUser,user=auth.currentUser;

      const usernameInput = document.getElementById('edit-username');
      const displayNameInput = document.getElementById('edit-display-name');
      const avatarFileInput = document.getElementById('edit-avatar-file');
      const bioInput = document.getElementById('edit-bio');
      const newUsername = usernameInput ? usernameInput.value.trim() : currentUser.username;
      const newDisplayName = displayNameInput ? displayNameInput.value.trim().slice(0, 40) : (currentUser.displayName || '');
      const newBio = bioInput ? bioInput.value.trim() : currentUser.bio;
      const newNeurotypes = getSelectedCheckboxes('edit-neurotypes-container');
      const file = avatarFileInput && avatarFileInput.files ? avatarFileInput.files[0] : null;
      if (file && (!file.type.startsWith('image/') || file.size > 250000)) {
        showToast('Choose an image smaller than 250 KB.');
        return;
      }
      const links = [];
      for (let i = 1; i <= 6; i++) {
        const labelEl = document.getElementById('edit-link-' + i + '-label');
        const urlEl = document.getElementById('edit-link-' + i + '-url');
        const label = labelEl ? labelEl.value.trim().slice(0, 50) : '';
        const url = urlEl ? safeProfileUrl(urlEl.value.trim()) : null;
        if (label && url) links.push({ label: label, url: url });
      }

      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const previous = Object.assign({}, currentUser);
      if (newUsername !== currentUser.username) {
        if (currentUser.lastUsernameChange && now - currentUser.lastUsernameChange < thirtyDaysMs) {
          const daysLeft = Math.ceil((thirtyDaysMs - (now - currentUser.lastUsernameChange)) / (1000 * 60 * 60 * 24));
          showToast('Username is locked. You can change it again in ' + daysLeft + ' days.');
          return;
        }
        profileConfirmationPending=true;
        let confirmed;
        try {confirmed=await confirmSiteAction('Change your username?','You will not be able to change it again for 30 days.','Change username');}
        finally {profileConfirmationPending=false;}
        if(!confirmed||currentUser!==profile||!auth.currentUser||auth.currentUser.uid!==user.uid)return;
        currentUser.username = newUsername;
        currentUser.lastUsernameChange = Date.now();
      }

      currentUser.email = auth.currentUser.email || '';
      currentUser.displayName = newDisplayName || null;
      currentUser.bio = newBio;
      currentUser.neurotypes = newNeurotypes;
      currentUser.links = links;

      let avatarPromise = Promise.resolve();
      if (file) {
        avatarPromise = new Promise(function(resolve, reject) {
          const reader = new FileReader();
          reader.onload = function(e) { currentUser.avatar = e.target.result; resolve(); };
          reader.onerror = function() { reject(new Error('Image could not be read.')); };
          reader.readAsDataURL(file);
        });
      }

      avatarPromise.then(persistUserProfile).then(function() {
        showToast('✨ Private profile saved to your account.');
        renderProfile();
      }).catch(function(error) {
        currentUser = previous;
        console.error('Profile save failed:', error.code || error.message);
        showToast('Profile could not be saved. Check your connection and try again.');
      });
    }

    function addProductToCart(sku, sizeSelectId, colorSelectId) {
      const product = CART_PRODUCTS[sku];
      if (!product) return;
      const sizeInput = document.getElementById(sizeSelectId);
      const colorInput = document.getElementById(colorSelectId);
      const requestedSize = sizeInput ? String(sizeInput.value).toUpperCase() : 'L';
      const requestedColor = colorInput ? String(colorInput.value).trim() : product.colors[0];
      const size = product.sizes.includes(requestedSize) ? requestedSize : 'L';
      const color = product.colors.includes(requestedColor) ? requestedColor : product.colors[0];
      if (cart.length >= 10) {
        showToast('Your bag can contain up to 10 items per checkout.');
        return;
      }
      cart.push({ sku: sku, size: size, color: color });
      persistCart();
      updateUI();
      showToast('Added ' + product.name + ' (' + color + ', Size: ' + size + ') to your bag.');
    }

   function toggleCartModal() {
      const authModal = document.getElementById('auth-modal');
      if (authModal && !authModal.classList.contains('hidden')) return; // Block basket if auth modal is open

      const modal = document.getElementById('cart-modal');
      if (!modal) return;
      if (modal.classList.contains('hidden')) {
        renderCartItems();
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      } else {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
      }
    }

    function renderCartItems() {
      const list = document.getElementById('cart-items-list');
      const subtotalEl = document.getElementById('cart-subtotal');
      const shippingRow = document.getElementById('shipping-row');
      const shippingEl = document.getElementById('cart-shipping');
      const discountRow = document.getElementById('discount-row');
      const discountAmountEl = document.getElementById('cart-discount-amount');
      const totalEl = document.getElementById('cart-total');
      
      if (!list) return;

      if (cart.length === 0) {
        list.innerHTML = '<p class="text-xs text-slate-400 text-center py-4">Your bag is empty.</p>';
        if (subtotalEl) subtotalEl.textContent = '£0.00';
        if (shippingRow) shippingRow.classList.add('hidden');
        if (discountRow) discountRow.classList.add('hidden');
        if (totalEl) totalEl.textContent = '£0.00';
        return;
      }

      let subtotal = 0;
      list.replaceChildren();
      cart.forEach((item, index) => {
        const product = CART_PRODUCTS[item.sku];
        if (!product) return;
        subtotal += product.price;
        const row = document.createElement('div');
        row.className = 'flex justify-between items-center bg-[#252923] p-2.5 rounded-lg text-sm';
        const description = document.createElement('div');
        description.textContent = product.name + ' (' + item.color + ', Size: ' + item.size + ')';
        const actions = document.createElement('div');
        actions.className = 'flex items-center gap-3';
        const price = document.createElement('span');
        price.className = 'text-[#cbb678]';
        price.textContent = '£' + product.price.toFixed(2);
        const removeButton = document.createElement('button');
        removeButton.className = 'text-rose-400 text-xs font-bold';
        removeButton.type = 'button';
        removeButton.textContent = '✕';
        removeButton.addEventListener('click', function() { removeItem(index); });
        actions.append(price, removeButton);
        row.append(description, actions);
        list.appendChild(row);
      });

      const shipping = 6.50;
      if (subtotalEl) subtotalEl.textContent = '£' + subtotal.toFixed(2);
      if (shippingRow) shippingRow.classList.remove('hidden');
      if (shippingEl) shippingEl.textContent = '£' + shipping.toFixed(2);

      if (currentUser && !currentUser.perkRedeemedAt && !currentUser.perkReservationId) {
        let discount = subtotal * 0.15;
        let finalTotal = subtotal - discount + shipping;
        if (discountRow) discountRow.classList.remove('hidden');
        if (discountAmountEl) discountAmountEl.textContent = '-£' + discount.toFixed(2);
        if (totalEl) totalEl.textContent = '£' + finalTotal.toFixed(2);
      } else {
        if (discountRow) discountRow.classList.add('hidden');
        if (totalEl) totalEl.textContent = '£' + (subtotal + shipping).toFixed(2);
      }
    }

    function removeItem(index) {
      cart.splice(index, 1);
      persistCart();
      updateUI();
      renderCartItems();
      showToast('Item removed from your bag.');
    }

    function openAuthModal(mode) {
      isLoginMode = (mode === 'login');
      const titleEl = document.getElementById('auth-modal-title');
      const submitBtn = document.getElementById('auth-submit-btn');
      const switchText = document.getElementById('auth-switch-text');

      if (titleEl) titleEl.textContent = isLoginMode ? 'Sign In to Account' : 'Create Community Account';
      if (submitBtn) submitBtn.textContent = isLoginMode ? 'Sign In' : 'Continue & Claim 15% Off';
      if (switchText) switchText.textContent = isLoginMode ? "Don't have an account? Register here" : 'Already have an account? Sign in here';
      
      const modal = document.getElementById('auth-modal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
      renderGoogleSignInButton();
    }

    function renderGoogleSignInButton() {
      const container = document.getElementById('google-signin-button');
      if (!container) return;
      container.replaceChildren();
      if (!window.google || !google.accounts || !google.accounts.id) {
        container.textContent = 'Google sign-in is temporarily unavailable. Please use email sign-in.';
        return;
      }
      if (!googleSignInInitialized) {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleSignIn,
          auto_select: false
        });
        googleSignInInitialized = true;
      }
      google.accounts.id.renderButton(container, {
        type: 'standard', shape: 'rectangular', theme: 'outline',
        text: 'continue_with', size: 'large', logo_alignment: 'left',
        width: Math.min(container.clientWidth || 360, 360)
      });
    }

    function closeAuthModal() {
      const modal = document.getElementById('auth-modal');
      if (modal) {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
      }
      if (searchAuthPrompt) {
        searchAuthPrompt = false;
        closeHeaderSearch();
      }
    }

    function toggleAuthMode() {
      isLoginMode = !isLoginMode;
      openAuthModal(isLoginMode ? 'login' : 'signup');
    }

    function handleAuthSubmit(e) {
      e.preventDefault();
      const emailInput = document.getElementById('auth-email');
      const passwordInput = document.getElementById('auth-password');
      
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';

      if (!isLoginMode) {
        auth.createUserWithEmailAndPassword(email, password)
          .then((userCredential) => {
            showToast('Account created securely!');
            closeAuthModal();
            openOnboardingModal();
          })
          .catch((error) => {
            showToast('Error: ' + error.message);
          });
      } else {
        auth.signInWithEmailAndPassword(email, password)
          .then((userCredential) => {
            showToast('Welcome back! Logged in securely.');
            closeAuthModal();
            updateUI();
          })
          .catch((error) => {
            showToast('Invalid email or password.');
          });
      }
    }

    function handleGoogleSignIn(response) {
      if (!response || !response.credential) {
        showToast('Google did not return a sign-in credential. Please try again.');
        return;
      }
      auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(response.credential))
        .then(function(result) {
          closeAuthModal();
          showToast('Signed in with Google securely.');
          if (result.additionalUserInfo && result.additionalUserInfo.isNewUser) openOnboardingModal();
        })
        .catch(function(error) {
          console.error('Firebase Google sign-in failed:', error.code || error.message);
          showToast('Google sign-in could not be completed (' + (error.code || 'auth/unknown') + ').');
        });
    }

    function openOnboardingModal() {
      const onboardName = document.getElementById('onboard-username');
      const email = auth.currentUser ? auth.currentUser.email : tempAuthEmail;
      if (onboardName) onboardName.value = auth.currentUser && auth.currentUser.displayName ? auth.currentUser.displayName : (email ? email.split('@')[0] : '');
      renderCheckboxList('onboard-neurotypes-container');
      const modal = document.getElementById('onboarding-modal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    }

    function handleOnboardingSubmit(e) {
      e.preventDefault();
      const usernameInput = document.getElementById('onboard-username');
      const username = usernameInput ? usernameInput.value.trim() : '';
      const displayNameInput = document.getElementById('onboard-display-name');
      const displayName = displayNameInput ? displayNameInput.value.trim().slice(0, 40) : '';
      const neurotypes = getSelectedCheckboxes('onboard-neurotypes-container');
      const user = auth.currentUser;
      if (!user || !username) {
        showToast('Sign in and choose a username before saving your profile.');
        return;
      }
      userProfileReady.then(function() {
        if (!auth.currentUser || auth.currentUser.uid !== user.uid) throw new Error('Account changed before profile save.');
        if (!currentUser || currentUser.uid !== user.uid) {
          currentUser = {
            uid: user.uid, email: user.email || '',
            username: user.displayName || (user.email || '').split('@')[0],
            displayName: null,
            avatar: user.photoURL || null,
            bio: user.uid === FOUNDER_AUTH_UID ? 'Founder of AuDHMe' : '',
            neurotypes: [], links: [], interestMedia: [], perkRedeemedAt: null
          };
        }
        const previous = Object.assign({}, currentUser);
        currentUser.username = username.slice(0, 40);
        currentUser.displayName = displayName || null;
        currentUser.neurotypes = neurotypes.filter(function(type) { return availableNeurotypes.includes(type); });
        return Promise.all([
          user.updateProfile({ displayName: currentUser.username }),
          persistUserProfile()
        ]).catch(function(error) {
          currentUser = previous;
          throw error;
        });
      }).then(function() {
        const onboardingModal = document.getElementById('onboarding-modal');
        if (onboardingModal) {
          onboardingModal.classList.remove('flex');
          onboardingModal.classList.add('hidden');
        }
        updateUI();
        showToast('Your profile and neurotype choices have been saved.');
      }).catch(function(error) {
        console.error('Onboarding profile save failed:', error.code || error.message);
        showToast('Profile could not be saved. Please try again.');
      });
    }

    function openForgotPassModal() {
      closeAuthModal();
      const modal = document.getElementById('forgot-pass-modal');
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    }

    function closeForgotPassModal() {
      const modal = document.getElementById('forgot-pass-modal');
      if (modal) {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
      }
    }

    function handlePasswordReset() {
      const emailInput = document.getElementById('forgot-email');
      const email = emailInput ? emailInput.value.trim() : '';
      if (!email) {
        showToast('Please enter your account email address.');
        return;
      }
      closeForgotPassModal();
      auth.sendPasswordResetEmail(email)
        .then(function() {
          closeForgotPassModal();
          showToast('Password reset email sent.');
        })
        .catch(function() {
          showToast('Unable to send the password reset email.');
        });
    }

    function handleLogout() {
    auth.signOut().then(() => {
      showToast('Signed out successfully.');
      switchPage('home', true);
    });
  }

    function proceedToCheckout() {
      if (cart.length === 0) {
        showToast('Your bag is empty!');
        return;
      }
      if (!auth.currentUser) {
        showToast('Sign in before checkout so your order can be linked to your account.');
        openAuthModal('login');
        return;
      }
      if (checkoutInProgress) return;
      checkoutInProgress = true;
      const checkoutButton = document.querySelector('#cart-modal button[onclick="proceedToCheckout()"]');
      if (checkoutButton) checkoutButton.disabled = true;
      Promise.resolve(userProfileReady).then(function() {
        return functions.httpsCallable('createCheckoutSession')({
          items: cart.map(function(item) { return { sku: item.sku, size: item.size, color: item.color }; })
        });
      }).then(function(result) {
        if (!result.data || !result.data.url) throw new Error('Checkout URL missing.');
        window.location.assign(result.data.url);
      }).catch(function(error) {
        console.error('Checkout session could not be created:', error.code || error.message);
        const code=String(error.code||'');
        showToast(code.includes('invalid-argument') || code.includes('failed-precondition') ? error.message : 'Checkout is unavailable. Check your connection and try again; contact the site owner if the problem continues.');
        checkoutInProgress = false;
        if (checkoutButton) checkoutButton.disabled = false;
      });
    }

    var confessionsCursor=null, confessionsLoading=false, confessionsAllLoaded=false, confessionsRenderVersion=0, confessionsListenersAttached=false;
    var CONFESSIONS_PAGE_SIZE=10;
    function getMyConfessionIds(){try{var raw=localStorage.getItem('audhme_my_confessions');var arr=raw?JSON.parse(raw):[];return Array.isArray(arr)?arr.filter(function(x){return typeof x==='string';}):[];}catch(e){return [];}}
    function addMyConfessionId(id){var ids=getMyConfessionIds();if(ids.indexOf(id)===-1)ids.push(id);try{localStorage.setItem('audhme_my_confessions',JSON.stringify(ids));}catch(e){}}
    function removeMyConfessionId(id){var ids=getMyConfessionIds().filter(function(x){return x!==id;});try{localStorage.setItem('audhme_my_confessions',JSON.stringify(ids));}catch(e){}}
    function formatConfessionDate(ts){try{if(ts&&ts.toDate)return ts.toDate().toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});}catch(e){}return 'Recently';}
    function attachConfessionListeners(){
      if(confessionsListenersAttached)return; confessionsListenersAttached=true;
      var input=document.getElementById('confession-input');
      var counter=document.getElementById('confession-counter');
      var submit=document.getElementById('confession-submit');
      if(input&&counter)input.addEventListener('input',function(){counter.textContent=input.value.length+' / 1000';});
      if(submit)submit.addEventListener('click',submitConfession);
      var more=document.getElementById('confessions-load-more');
      if(more)more.addEventListener('click',function(){loadConfessions(true);});
    }
    async function submitConfession(){
      var input=document.getElementById('confession-input');
      var submit=document.getElementById('confession-submit');
      var status=document.getElementById('confession-status');
      var text=input?input.value.trim():'';
      if(!auth.currentUser){if(status)status.textContent='Sign in to share.';return;}
      if(!text){if(status)status.textContent='Write something first.';return;}
      if(submit)submit.disabled=true;
      try{
        var result=await functions.httpsCallable('createConfession')({text:text.slice(0,1000)});
        if(result&&result.data&&result.data.id)addMyConfessionId(result.data.id);
        if(input)input.value='';
        var counter=document.getElementById('confession-counter');if(counter)counter.textContent='0 / 1000';
        if(status)status.textContent='Shared anonymously. Thank you for trusting the community.';
        confessionsCursor=null;confessionsAllLoaded=false;
        loadConfessions(false);
      }catch(error){console.error('Confession could not be shared:',error.code||error.message);if(status)status.textContent='That could not be shared. Check your connection and try again.';}
      finally{if(submit)submit.disabled=false;}
    }
    async function toggleConfessionSupport(id,button,countEl){
      if(!auth.currentUser)return;
      button.disabled=true;
      try{
        var ref=db.collection('confessions').doc(id).collection('supports').doc(auth.currentUser.uid);
        var snap=await ref.get();
        var count=parseInt((countEl.textContent||'0').replace(/[^0-9]/g,''),10)||0;
        if(snap.exists){await ref.delete();count=Math.max(0,count-1);button.setAttribute('aria-pressed','false');button.textContent='♡ Support';}
        else{await ref.set({uid:auth.currentUser.uid});count++;button.setAttribute('aria-pressed','true');button.textContent='♥ Supported';}
        countEl.textContent=count+' '+(count===1?'support':'supports');
      }catch(error){console.error('Support could not be updated:',error.code||error.message);}
      finally{button.disabled=false;}
    }
    async function deleteConfessionItem(id,card){
      if(!auth.currentUser)return;
      if(!await confirmSiteAction('Delete this confession?','It will be permanently removed.','Delete'))return;
      try{await functions.httpsCallable('deleteConfession')({id:id});removeMyConfessionId(id);if(card&&card.parentNode)card.parentNode.removeChild(card);}
      catch(error){console.error('Confession could not be deleted:',error.code||error.message);showToast('That confession could not be deleted.');}
    }
    async function loadConfessionComments(id,container,statusEl){
      if(!auth.currentUser)return;
      try{
        var snap=await db.collection('confessions').doc(id).collection('comments').orderBy('createdAt','desc').limit(50).get();
        container.replaceChildren();
        if(!snap.size){var empty=document.createElement('p');empty.className='text-xs text-slate-400';empty.textContent='No supportive notes yet. Be the first.';container.appendChild(empty);}
        else snap.docs.forEach(function(doc){var data=doc.data();var wrap=document.createElement('div');wrap.className='confession-comment';var who=document.createElement('span');who.className='who';who.textContent='Supporter';var p=document.createElement('p');p.textContent=data.text;wrap.append(who,p);container.appendChild(wrap);});
      }catch(error){console.error('Confession comments could not be loaded:',error.code||error.message);if(statusEl)statusEl.textContent='Supportive notes could not be loaded.';}
    }
    async function submitConfessionComment(id,input,list,statusEl){
      var text=input?input.value.trim():'';
      if(!auth.currentUser||!text)return;
      input.disabled=true;
      try{
        await db.collection('confessions').doc(id).collection('comments').add({text:text.slice(0,500),createdAt:firebase.firestore.FieldValue.serverTimestamp()});
        input.value='';
        loadConfessionComments(id,list,statusEl);
      }catch(error){console.error('Confession comment could not be posted:',error.code||error.message);if(statusEl)statusEl.textContent='That note could not be posted.';}
      finally{input.disabled=false;}
    }
    function renderConfessionCard(doc,myIds){
      var data=doc.data();
      var card=document.createElement('article');card.className='confession-card';
      var text=document.createElement('p');text.className='confession-text';text.textContent=data.text;
      var meta=document.createElement('p');meta.className='confession-meta';meta.textContent='Shared anonymously · '+formatConfessionDate(data.createdAt);
      var actions=document.createElement('div');actions.className='confession-actions';
      var supportBtn=document.createElement('button');supportBtn.type='button';supportBtn.className='confession-support-btn';supportBtn.setAttribute('aria-pressed','false');supportBtn.textContent='♡ Support';
      var supportCount=document.createElement('span');supportCount.className='gallery-comment-like-count';supportCount.textContent='0 supports';
      supportBtn.addEventListener('click',function(){toggleConfessionSupport(doc.id,supportBtn,supportCount);});
      db.collection('confessions').doc(doc.id).collection('supports').get().then(function(snap){var count=snap.size;var liked=auth.currentUser&&snap.docs.some(function(d){return d.id===auth.currentUser.uid;});supportCount.textContent=count+' '+(count===1?'support':'supports');supportBtn.setAttribute('aria-pressed',String(liked));supportBtn.textContent=liked?'♥ Supported':'♡ Support';}).catch(function(){});
      var expandBtn=document.createElement('button');expandBtn.type='button';expandBtn.className='confession-expand-btn';expandBtn.textContent='Show supportive notes';
      var commentsWrap=document.createElement('div');commentsWrap.className='confession-comments';commentsWrap.style.display='none';
      var commentsList=document.createElement('div');commentsList.className='confession-comments-list';
      var commentForm=document.createElement('form');commentForm.className='confession-comment-form';
      var commentInput=document.createElement('input');commentInput.type='text';commentInput.maxLength=500;commentInput.placeholder='Leave a supportive note (anonymous)…';commentInput.setAttribute('aria-label','Supportive note');
      var commentSend=document.createElement('button');commentSend.type='submit';commentSend.className='calm-secondary-button';commentSend.textContent='Send';
      var commentStatus=document.createElement('p');commentStatus.className='text-xs text-slate-400 mt-1';
      commentForm.append(commentInput,commentSend);
      commentForm.addEventListener('submit',function(e){e.preventDefault();submitConfessionComment(doc.id,commentInput,commentsList,commentStatus);});
      commentsWrap.append(commentsList,commentForm,commentStatus);
      var commentsLoaded=false;
      expandBtn.addEventListener('click',function(){var hidden=commentsWrap.style.display==='none';commentsWrap.style.display=hidden?'block':'none';expandBtn.textContent=hidden?'Hide supportive notes':'Show supportive notes';if(hidden&&!commentsLoaded){commentsLoaded=true;loadConfessionComments(doc.id,commentsList,commentStatus);}});
      actions.append(supportBtn,supportCount,expandBtn);
      if(myIds.indexOf(doc.id)!==-1){var delBtn=document.createElement('button');delBtn.type='button';delBtn.className='confession-delete-btn';delBtn.textContent='Delete (yours)';delBtn.addEventListener('click',function(){deleteConfessionItem(doc.id,card);});actions.appendChild(delBtn);}
      card.append(text,meta,actions,commentsWrap);
      return card;
    }
    async function loadConfessions(append){
      if(confessionsLoading)return;
      var list=document.getElementById('confessions-list');
      var more=document.getElementById('confessions-load-more');
      var status=document.getElementById('confession-status');
      if(!list)return;
      confessionsLoading=true;if(more)more.disabled=true;
      var version=++confessionsRenderVersion;
      try{
        var query=db.collection('confessions').where('status','==','visible').orderBy('createdAt','desc').limit(CONFESSIONS_PAGE_SIZE);
        if(append&&confessionsCursor)query=query.startAfter(confessionsCursor);
        var snap=await query.get();
        if(version!==confessionsRenderVersion||!auth.currentUser)return;
        var myIds=getMyConfessionIds();
        if(!append)list.replaceChildren();
        if(!snap.size&&!append){var empty=document.createElement('p');empty.className='profile-gallery-empty';empty.textContent='No confessions shared yet. Be the first to share something anonymously.';list.appendChild(empty);}
        else snap.docs.forEach(function(doc){list.appendChild(renderConfessionCard(doc,myIds));});
        confessionsCursor=snap.docs.length?snap.docs[snap.docs.length-1]:confessionsCursor;
        confessionsAllLoaded=snap.size<CONFESSIONS_PAGE_SIZE;
        if(more){more.hidden=confessionsAllLoaded;more.disabled=false;more.textContent='Load more';}
      }catch(error){console.error('Confessions could not be loaded:',error.code||error.message);if(status)status.textContent='Confessions could not be loaded. Check your connection and try again.';if(more){more.hidden=true;more.disabled=false;}}
      finally{confessionsLoading=false;}
    }
    function renderConfessions(){
      attachConfessionListeners();
      var signedOut=document.getElementById('confessions-signed-out');
      var composer=document.getElementById('confessions-composer-wrap');
      var list=document.getElementById('confessions-list');
      var more=document.getElementById('confessions-load-more');
      if(!auth.currentUser){
        if(signedOut)signedOut.classList.remove('hidden');
        if(composer)composer.classList.add('hidden');
        if(list)list.replaceChildren();
        if(more)more.classList.add('hidden');
        return;
      }
      if(signedOut)signedOut.classList.add('hidden');
      if(composer)composer.classList.remove('hidden');
      confessionsCursor=null;confessionsAllLoaded=false;
      loadConfessions(false);
    }

    updateUI();

    const googleIdentityScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (googleIdentityScript) {
      googleIdentityScript.addEventListener('load', function() {
        const authModal = document.getElementById('auth-modal');
        if (authModal && !authModal.classList.contains('hidden')) renderGoogleSignInButton();
      });
    }
