    function handleAuthRedirect() {
        if (!window.location.hash) return false;
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const idToken = hashParams.get('id_token');
        const error = hashParams.get('error');
        if (!idToken && !error) return false;

        // Clean the token/error out of the URL so refresh/back doesn't resubmit it.
        history.replaceState(null, '', window.location.pathname + window.location.search);

        if (error) {
            showLoginError('Đăng nhập thất bại: ' + escapeHTML(error));
            return true;
        }

        const payload = decodeJwtResponse(idToken);
        const email = payload.email;
        if (email && email.endsWith('@ghn.vn')) {
            showDashboard();
        } else {
            showLoginError('Lỗi: Email <strong>' + escapeHTML(email || '') + '</strong> không được phép truy cập.<br>Vui lòng sử dụng tài khoản @ghn.vn!');
        }
        return true;
    }

    function initLogin() {
        const btn = document.getElementById('google-login-btn');
        if (btn) btn.addEventListener('click', startGoogleLogin);
        handleAuthRedirect();
        document.getElementById('loading-overlay').classList.add('hidden');
    }
