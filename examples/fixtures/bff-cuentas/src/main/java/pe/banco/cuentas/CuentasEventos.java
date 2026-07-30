package pe.banco.cuentas;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import io.quarkus.redis.datasource.ReactiveRedisDataSource;
import org.eclipse.microprofile.reactive.messaging.Channel;
import org.eclipse.microprofile.reactive.messaging.Emitter;
import org.eclipse.microprofile.reactive.messaging.Incoming;

@ApplicationScoped
public class CuentasEventos {

    @Inject
    ReactiveRedisDataSource redis;

    @Channel("cuentas-consultadas")
    Emitter<ConsultaEvent> emitter;

    public void publicarConsulta(String clienteId) {
        emitter.send(new ConsultaEvent(clienteId));
    }

    @Incoming("cuentas-actualizadas")
    public void alActualizarse(CuentaActualizada evento) {
        redis.invalidate("cuentas:" + evento.clienteId());
    }
}
