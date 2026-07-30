package pe.banco.cuentas;

import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.rest.client.inject.RestClient;

/**
 * Recurso de cuentas. La URL final es /v1/cuentas porque quarkus.http.root-path=/v1.
 */
@Path("/cuentas")
@Produces(MediaType.APPLICATION_JSON)
public class CuentasResource {

    @Inject
    @RestClient
    CustomerRestClient customerClient;

    @Inject
    CuentasService service;

    // Este comentario contiene una URL http://no-deberia-detectarse.com para
    // comprobar que el recolector ignora los comentarios.
    @GET
    public List<CuentaDto> listarCuentas() {
        return service.listar();
    }

    @GET
    @Path("/{id}/movimientos")
    public List<MovimientoDto> listarMovimientos(@PathParam("id") String id) {
        return service.movimientos(id);
    }

    @POST
    @Path("/transferencias")
    public TransferenciaDto transferir(TransferenciaRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request requerido");
        }
        return service.transferir(request);
    }
}
