# Blockgram

https://blockgramunitec-proyecto1.vercel.app/proyecto.html

Blockgram es una aplicación web para organizar notas, fragmentos de código, proyectos y tareas. Las cuentas del servidor permiten acceder a las notas, proyectos, tareas y progreso desde distintos dispositivos mediante una API en Python y una base de datos SQLite.

## Funcionalidades

- Registro e inicio de sesión con usuario y contraseña.
- Registro e inicio de sesión locales por usuario cuando no hay API; los datos no se sincronizan entre dispositivos.
- Gestión de cuenta desde la barra lateral: cambio de contraseña, cierre de sesión y cambio de cuenta.
- Eliminación de cuenta con confirmación y verificación de contraseña, junto con sus datos asociados.
- Notas con búsqueda por título o contenido y un editor con resaltado de sintaxis.
- Proyectos, tareas, fechas de entrega, seguimiento del tiempo y recomendaciones de estudio.
- Sincronización de datos de la cuenta y almacenamiento local separado por usuario.
- Detección de cambios simultáneos para que el usuario elija qué versión conservar.
- Exportación e importación de respaldos JSON.
- Interfaz adaptable a escritorio y dispositivos móviles.
- Pantalla de acceso con figuras geométricas sutiles y animaciones que respetan la preferencia de movimiento reducido.

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

Abre https://blockgramunitec-proyecto1.vercel.app/proyecto.html en el navegador y mantén la terminal abierta mientras uses la aplicación. En Windows también puedes ejecutar `python .\server.py` si `python` apunta a la instalación adecuada.

Para usar registro, inicio de sesión y sincronización entre dispositivos, inicia `server.py` como se indica arriba. Si abres la aplicación con un servidor estático o la despliegas en Vercel sin una API, la pantalla de usuario y contraseña permanece disponible y ofrece **Continuar como invitado/local**. El modo invitado guarda notas, snippets, proyectos, tareas, calendario, rachas y respaldos con `localStorage` e `IndexedDB` en ese navegador. No crea ni autentica cuentas y los datos no se comparten con otros dispositivos.

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
- El servidor garantiza que cada nombre sea único, sin distinguir mayúsculas; por ejemplo, `Pedrito.122` y `pedrito.122` corresponden a la misma cuenta.
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
| `POST` | `/api/change-password` | Cambia la contraseña autenticando la contraseña actual. |
| `POST` | `/api/delete-account` | Elimina la cuenta autenticada y sus datos del servidor tras verificar la contraseña. |
| `GET` | `/api/data` | Obtiene el documento de la cuenta y su revisión. |
| `PUT` | `/api/data` | Guarda el documento si `expectedRevision` coincide con la revisión actual. |

Las rutas de registro e inicio reciben JSON con `username` y `password`. El cambio de contraseña recibe `currentPassword` y `newPassword`, requiere la sesión activa y el encabezado `X-Blockgram-Account`; las otras sesiones de esa cuenta se invalidan al completarlo. El borrado recibe `currentPassword` y `X-Blockgram-Account`; elimina también las sesiones y datos asociados del servidor. La interfaz además borra las copias locales de esa cuenta en el navegador actual. Las copias locales de otros dispositivos no se pueden borrar remotamente. Las respuestas de error contienen un campo `error`. Una actualización con revisión obsoleta devuelve `409 Conflict` junto con la versión remota para permitir resolver el conflicto.

## Publicación

Para usar cuentas y sincronización desde Internet, despliega la aplicación en un servicio que ejecute Python y proporcione almacenamiento persistente. Configura el comando de inicio como `python server.py` y permite que el hosting asigne el puerto mediante `PORT`. Un despliegue estático en Vercel sirve la interfaz, pero no ejecuta `server.py`; en ese caso el registro e inicio de sesión funcionan localmente en el navegador.

En el modo local, cada usuario (sin distinguir mayúsculas y minúsculas) y el invitado tienen espacios separados de notas, proyectos y adjuntos en `localStorage` e `IndexedDB`. Las cuentas locales son específicas del navegador y del origen, no se sincronizan y no se comparten entre dispositivos. Las contraseñas locales se guardan como derivaciones PBKDF2, no como texto plano, y se pueden cambiar desde **Mi cuenta**.

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
| `auth.js` | Registro e inicio de sesión local o en el servidor, gestión de cuenta y aislamiento de datos por usuario. |
| `server.py` | Servidor web, API, validación, sesiones y persistencia SQLite. |
| `README.md` | Documentación del proyecto y su operación. |
| `index.html` | Entrada de la raíz; redirige a `proyecto.html`. |

## Comprobaciones

Antes de subir los cambios a GitHub y desplegar en Vercel:

1. Confirma que `index.html`, `proyecto.html`, `proyecto.css`, `proyecto.js` y `auth.js` estén incluidos en el repositorio y que Vercel use la raíz del proyecto como directorio de despliegue.
2. Abre la URL raíz y confirma que redirija a la aplicación. En una vista previa estática de Vercel, comprueba que aparezca el aviso de modo local aunque no exista `server.py` ni `/api/session`.
3. En esa vista previa, registra dos usuarios distintos (por ejemplo, `ana` y `luis`) con contraseñas de al menos 10 caracteres. Añade notas y proyectos distintos, cambia de cuenta y verifica que cada uno solo vea sus propios datos. Recarga e inicia sesión de nuevo para comprobar que se conservan.
4. En **Mi cuenta → Cambiar contraseña**, cambia la clave de una cuenta local; cierra sesión y comprueba que la clave nueva funciona y la anterior no.
5. Comprueba que `ANA` no se pueda registrar si ya existe `ana`. Añade adjuntos con cada cuenta y con **Continuar como invitado/local** para comprobar que también estén separados en IndexedDB; prueba Exportar e Importar.
6. En **Mi cuenta → Eliminar cuenta**, confirma el nombre y la contraseña de una cuenta de prueba. Verifica que desaparezcan sus datos locales y que otra cuenta conserve los suyos.
7. Para comprobar cuentas entre dispositivos, inicia `py .\server.py`, registra un usuario y contraseña, y entra con esas mismas credenciales desde otro navegador. Intenta registrar el mismo nombre con mayúsculas distintas y confirma que el servidor lo rechace.
8. Cambia la contraseña de una cuenta del servidor y comprueba que puedas entrar con la nueva clave desde otro navegador.
9. Elimina una cuenta de prueba en el servidor e intenta iniciar sesión de nuevo; la cuenta debe haber sido eliminada sin afectar a las demás.
10. Confirma que **Continuar como invitado/local** abre un espacio independiente de las cuentas; los datos locales no aparecerán en otro navegador o dispositivo.

### Verificación de esta revisión

- `python -m py_compile .\server.py`: correcto.
- Se ejecutaron 18 comprobaciones de integración de la API con una base SQLite temporal: registro, inicio y rechazo de credenciales, unicidad sin distinguir mayúsculas, aislamiento y persistencia de datos, cambio de contraseña, eliminación de cuenta y cierre de sesión.
- En el navegador integrado se verificaron el registro e inicio de sesión local, la persistencia de una nota tras recargar, el aislamiento entre dos cuentas, el modo invitado y las opciones de cuenta. También se probaron el cambio de contraseña y la eliminación local de las cuentas de prueba.
- Se corrigió el manejador de navegación lateral para que solo procese enlaces; el botón **Mi cuenta** ya no provoca una excepción de JavaScript.
- Se añadieron las propiedades estándar `line-clamp` junto con las variantes WebKit existentes.
- Se eliminó el ancho mínimo fijo del documento que provocaba desbordamiento horizontal en pantallas estrechas. También se apiló el panel del dashboard hasta 900 px y se mantuvieron los cinco accesos en una fila en la navegación móvil. Se comprobó el ancho del documento en el panel, notas, proyectos y horario a 320, 360, 390, 600, 768, 1024, 1366 y 1920 px.
- El entorno dispone de Python 3.15.2, pero no de Node.js ni Docker; por eso no se ejecutaron `node --check` ni pruebas Playwright. La interfaz se ejercitó en el navegador integrado y la API se probó con la biblioteca estándar de Python. El proyecto aún no incluye una suite automatizada permanente.

Para comprobar la sintaxis del servidor:

```powershell
py -m py_compile .\server.py
```

Si Node.js está instalado, también puedes comprobar la sintaxis de los scripts del navegador:

```powershell
node --check .\proyecto.js
