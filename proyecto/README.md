# Blockgram

Blockgram es una aplicación web para organizar notas, fragmentos de código, proyectos y tareas. Las cuentas permiten acceder a las notas, proyectos, tareas y progreso desde distintos dispositivos mediante una API en Python y una base de datos SQLite.

## Funcionalidades

- Registro e inicio de sesión con usuario y contraseña.
- Notas con búsqueda por título o contenido y un editor con resaltado de sintaxis.
- Proyectos, tareas, fechas de entrega, seguimiento del tiempo y recomendaciones de estudio.
- Sincronización de datos de la cuenta y almacenamiento local separado por usuario.
- Detección de cambios simultáneos para que el usuario elija qué versión conservar.
- Exportación e importación de respaldos JSON.
- Interfaz adaptable a escritorio y dispositivos móviles.

## Tecnologías

| Componente | Tecnología |
| --- | --- |
| Interfaz | HTML, CSS y JavaScript nativo |
| Editor de código | CodeMirror 5 desde cdnjs |
| Servidor y API | Python estándar: `http.server` y `sqlite3` |
| Base de datos | SQLite |
| Archivos adjuntos | IndexedDB del navegador |

El proyecto no requiere instalar paquetes de Python. El resaltado de sintaxis carga CodeMirror desde cdnjs, por lo que esa función requiere conexión a Internet.

## Requisitos

- Python 3.10 o posterior.
- Un navegador moderno con JavaScript e IndexedDB habilitados.
- Acceso a cdnjs para cargar CodeMirror y sus modos de lenguaje.

## Ejecución local

Desde la carpeta del proyecto, inicia el servidor:

```powershell
py .\server.py
```

Abre [http://localhost:8000](http://localhost:8000) en el navegador y mantén la terminal abierta mientras uses la aplicación. En Windows también puedes ejecutar `python .\server.py` si `python` apunta a la instalación adecuada.

Para usar registro, inicio de sesión y sincronización entre dispositivos, inicia `server.py` como se indica arriba. Si abres la aplicación con un servidor estático o la despliegas en Vercel sin una API, Blockgram abre automáticamente en modo local: notas, snippets, proyectos, tareas, calendario, rachas y respaldos funcionan con `localStorage` e `IndexedDB` en ese navegador. En modo local no hay cuentas, sincronización entre dispositivos ni una sesión remota; los datos permanecen en el dispositivo y se pueden respaldar desde Exportar.

La raíz del proyecto incluye `index.html`, que redirige a `proyecto.html`. Esto permite que Vercel sirva la aplicación al visitar la URL raíz.

El servidor escucha en `0.0.0.0` y, de forma predeterminada, usa el puerto `8000`. Para probarlo desde otro dispositivo de la misma red, ambos deben poder acceder a la máquina que lo ejecuta y se debe usar la dirección IP de esa máquina. El acceso desde fuera de la red requiere publicar el servidor en un hosting.

## Configuración

| Variable | Descripción | Valor predeterminado |
| --- | --- | --- |
| `PORT` | Puerto de escucha del servidor. | `8000` |
| `BLOCKGRAM_DB_PATH` | Ruta completa de la base de datos SQLite. | `~/.blockgram/blockgram.sqlite3` |
| `BLOCKGRAM_COOKIE_SECURE` | Si es `1`, `true` o `yes`, añade el atributo `Secure` a la cookie de sesión. | Desactivado |

Ejemplo para una sesión de PowerShell:

```powershell
$env:PORT = "8000"
$env:BLOCKGRAM_DB_PATH = "$env:USERPROFILE\.blockgram\blockgram.sqlite3"
py .\server.py
```

La carpeta de la base de datos se crea automáticamente. En un hosting, configura `BLOCKGRAM_DB_PATH` para apuntar a almacenamiento persistente.

## Cuentas y sesiones

- Los nombres de usuario deben tener entre 3 y 30 caracteres: letras ASCII, números, punto, guion o guion bajo. Deben comenzar con una letra o un número.
- Los nombres repetidos no distinguen mayúsculas; por ejemplo, `Pedrito.122` y `pedrito.122` corresponden al mismo nombre.
- La contraseña de registro debe tener al menos 10 caracteres y no puede superar 128 caracteres.
- Las contraseñas se almacenan como hashes con salt; la aplicación no ofrece recuperación de contraseña por correo.
- Las sesiones duran hasta 30 días y usan una cookie `HttpOnly` con `SameSite=Lax`.

## Datos y sincronización

Las notas, proyectos, tareas, selección de proyecto, sesión de trabajo y progreso diario se guardan en la cuenta y se sincronizan con el servidor. Los datos locales del navegador se separan por usuario.

Cada documento sincronizado tiene una revisión. Si dos dispositivos modifican la misma cuenta a la vez, Blockgram detecta la revisión obsoleta y conserva ambas versiones para que el usuario elija cuál mantener o descargue ambas para compararlas. No se aplica una sobrescritura silenciosa.

El servidor limita cada solicitud a **2 MiB**. Si el documento supera el límite, no se sincroniza y la aplicación informa del problema; los datos locales se conservan para que se pueda reducir su tamaño.

### Archivos adjuntos

Los adjuntos se guardan en IndexedDB y permanecen en el dispositivo donde se agregaron: **no se sincronizan con la cuenta ni con otros dispositivos**. Cada archivo puede tener hasta **20 MiB**. Los respaldos admiten hasta **50 MiB** en adjuntos en total.

## Respaldos

Usa las opciones **Exportar** e **Importar** de la aplicación para crear o restaurar un archivo JSON. Los respaldos pueden incluir datos y archivos adjuntos. Guarda las exportaciones en un lugar seguro: pueden contener información personal o de trabajo.

## API

La interfaz y la API se sirven desde el mismo origen. Las operaciones de escritura requieren una solicitud del mismo origen; las rutas de datos requieren una sesión autenticada y el encabezado `X-Blockgram-Account` correspondiente al usuario de esa sesión.

| Método | Ruta | Propósito |
| --- | --- | --- |
| `GET` | `/api/session` | Consulta si existe una sesión activa. |
| `POST` | `/api/register` | Crea una cuenta y su documento inicial. |
| `POST` | `/api/login` | Inicia sesión. |
| `POST` | `/api/logout` | Cierra la sesión. |
| `GET` | `/api/data` | Obtiene el documento de la cuenta y su revisión. |
| `PUT` | `/api/data` | Guarda el documento si `expectedRevision` coincide con la revisión actual. |

Las rutas de registro e inicio reciben JSON con `username` y `password`. Las respuestas de error contienen un campo `error`. Una actualización con revisión obsoleta devuelve `409 Conflict` junto con la versión remota para permitir resolver el conflicto.

## Publicación

Para usar cuentas y sincronización desde Internet, despliega la aplicación en un servicio que ejecute Python y proporcione almacenamiento persistente. Configura el comando de inicio como `python server.py` y permite que el hosting asigne el puerto mediante `PORT`. Un despliegue estático en Vercel sirve la interfaz, pero no ejecuta `server.py`; allí la aplicación usa el modo local descrito arriba, a menos que configures y conectes una API compatible por separado.

En producción:

1. Sirve la aplicación detrás de HTTPS.
2. Configura `BLOCKGRAM_COOKIE_SECURE=1`.
3. Usa una ruta persistente para `BLOCKGRAM_DB_PATH`.
4. Restringe el acceso al archivo SQLite y a sus copias de respaldo.
5. Configura respaldos periódicos del almacenamiento persistente y prueba su restauración.

Un reinicio, cambio de instancia o redeploy puede borrar las cuentas y sus datos si el hosting no conserva el archivo SQLite.

## Estructura del proyecto

| Archivo | Responsabilidad |
| --- | --- |
| `proyecto.html` | Estructura de la interfaz, formularios y vistas. |
| `proyecto.css` | Estilos y diseño adaptable. |
| `proyecto.js` | Notas, proyectos, tareas, calendario, adjuntos y sincronización. |
| `auth.js` | Registro, inicio y cierre de sesión; aislamiento de datos locales por cuenta. |
| `server.py` | Servidor web, API, validación, sesiones y persistencia SQLite. |
| `README.md` | Documentación del proyecto y su operación. |
| `index.html` | Entrada de la raíz; redirige a `proyecto.html`. |

## Comprobaciones

Antes de subir los cambios a GitHub y desplegar en Vercel:

1. Confirma que `index.html`, `proyecto.html`, `proyecto.css`, `proyecto.js` y `auth.js` estén incluidos en el repositorio y que Vercel use la raíz del proyecto como directorio de despliegue.
2. Abre la URL raíz y confirma que redirija a la aplicación. En una vista previa estática de Vercel, comprueba que la interfaz aparezca aunque no exista `server.py` ni `/api/session`; el estado debe indicar **Solo en este dispositivo**.
3. En esa vista previa, crea una nota y un proyecto con tareas, recarga la página y comprueba que sigan ahí. Prueba también calendario y racha.
4. Añade un adjunto para comprobar IndexedDB y prueba Exportar e Importar con un respaldo JSON. Los datos locales de prueba no se comparten con otros dispositivos.
5. Si quieres cuentas y sincronización, prueba además el flujo con `py .\server.py` en `http://localhost:8000`; un despliegue estático de Vercel no proporciona esa API.

Para comprobar la sintaxis del servidor:

```powershell
py -m py_compile .\server.py
```

Si Node.js está instalado, también puedes comprobar la sintaxis de los scripts del navegador:

```powershell
node --check .\proyecto.js
node --check .\auth.js
```

El proyecto no incluye actualmente una suite de pruebas automatizada.

## Limitaciones conocidas

- Los adjuntos son locales al navegador y no se sincronizan entre dispositivos.
- No existe recuperación de contraseña por correo.
- La ejecución de fragmentos de código está desactivada.
- Si la API no está disponible al iniciar, Blockgram abre en modo local. Si la API falla después de iniciar una sesión autenticada, los cambios se conservan en el navegador y la interfaz informa que no se pudieron sincronizar.

## Licencia

El repositorio no especifica una licencia de distribución.
