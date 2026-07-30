package pe.banco.cuentas;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

@RegisterRestClient(configKey = "customer-api")
@Path("/internal/clientes")
public interface CustomerRestClient {

    @GET
    @Path("/{id}/cuentas")
    List<CuentaDto> cuentasDelCliente(@PathParam("id") String id);

    @GET
    @Path("/{id}")
    ClienteDto obtener(@PathParam("id") String id);
}
