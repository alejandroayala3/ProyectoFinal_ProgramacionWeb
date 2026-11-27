import '../src/login.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import { useState } from 'react';
import { guardarSesion, solicitudApi } from '../src/api.js';

function Login({ onLogin }) {
    const [correo, setCorreo] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [cargando, setCargando] = useState(false);

    //funcion que se ejecuta cuadno se da clic en el boton 'ACCEDER'
    const manejarLogin = async (e) => {
        e.preventDefault(); // Evita que la página se recargue
        setError('');
        setCargando(true);

        try {
            const sesion = await solicitudApi('/auth/login', {
                method: 'POST',
                body: { correo: correo.trim(), password }
            });
            onLogin(guardarSesion(sesion));
        } catch (error) {
            setError(error.message || 'No se pudo iniciar sesión.');
        } finally {
            setCargando(false);
        }
    };

    return (
        <section className="loginSection" data-bs-theme="dark">
            <div className="login-intro">
                <img className="login-brand-logo" src="/brand/origenes-logo.png" alt="Orígenes SV" />
                <div className="login-copy">
                    <h1 className="login-heading">
                        Sabor y tradición,<br />
                        en cada ocasión.
                    </h1>
                    <p className="login-description">
                        Inicia sesión para gestionar tu sucursal.
                    </p>
                </div>
            </div>
            <div className="login-auth">
                <form className="login-form" onSubmit={manejarLogin}>
                    <h3>Iniciar sesión</h3>
                    <span className="login-card-subtitle">Usa las credenciales de tu cuenta para iniciar sesión.</span>
                    <div data-mdb-input-init className="form-outline">
                        <label className="form-label" htmlFor="form3Example3">Correo electrónico</label>
                        <input
                            type="email"
                            id="form3Example3"
                            className="form-control"
                            value={correo}
                            onChange={(event) => setCorreo(event.target.value)}
                            autoComplete="username"
                            maxLength={150}
                            required
                        />
                    </div>

                    <div data-mdb-input-init className="form-outline">
                        <label className="form-label" htmlFor="form3Example4">Contraseña</label>
                        <input
                            type="password"
                            id="form3Example4"
                            className="form-control"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="current-password"
                            required
                        />
                    </div>
                    {error && <div className="alert alert-danger" role="alert">{error}</div>}
                    <button
                        type="submit"
                        data-mdb-button-init
                        data-mdb-ripple-init
                        className="btn login-submit"
                        disabled={cargando}
                    >

                        {/*flecha para acceder*/}
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" className="bi bi-arrow-right-short" viewBox="0 0 16 16">
                            <path fillRule="evenodd" d="M4 8a.5.5 0 0 1 .5-.5h5.793L8.146 5.354a.5.5 0 1 1 .708-.708l3 3a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708-.708L10.293 8.5H4.5A.5.5 0 0 1 4 8" />
                        </svg>

                        <span>{cargando ? 'Ingresando...' : 'Acceder'}</span>
                    </button>
                </form>
            </div>
        </section>



    );
}

export default Login;